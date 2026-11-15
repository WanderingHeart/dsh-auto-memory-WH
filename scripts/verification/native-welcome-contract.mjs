/** Read-only verification of the installed Desktop welcome path; no ASAR extraction. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
const asar = 'C:/DeepSeek Harness/resources/app.asar'
const data = await fs.readFile(asar)
const sha256 = createHash('sha256').update(data).digest('hex').toUpperCase()
const expected = 'E1B6F25FA937DA98086C3E77AF77AA14791105963C4D337A1C42179D232C6915'
if (sha256 !== expected) throw new Error('Desktop ASAR changed; verify the installed build before inspecting welcome behavior')
const header = JSON.parse(data.subarray(16, 16 + data.readUInt32LE(12)).toString('utf8'))
const dataStart = 8 + data.readUInt32LE(4)
function readEntry(parts) {
  let entry = header
  for (const part of parts) entry = entry.files?.[part]
  if (!entry || typeof entry.size !== 'number' || !/^\d+$/.test(entry.offset)) throw new Error('Unexpected ASAR entry')
  const start = dataStart + Number(entry.offset)
  return data.subarray(start, start + entry.size).toString('utf8')
}
const manifest = JSON.parse(readEntry(['package.json']))
const main = readEntry(['lib', 'main.js'])
const welcome = readEntry(['lib', 'welcome', 'welcome.js'])
const facts = {
  welcomeOnlyWhenNoAccountAndNoApiKey: main.includes('return !authentication.loggedIn && !authentication.hasApiKey;'),
  skipRoutesToWorkspace: main.includes('skip: enterWorkspace'),
  skipIsWelcomeIpc: main.includes('await operations.skip();'),
  keyPageHasSkipButton: welcome.includes('id:"skip-key"') && welcome.includes('h.skip()'),
  chineseSkipLabel: main.includes('welcomeKeyLater: "稍后配置"'),
  anonymousUpdatePolicy: manifest.dshMandatoryUpdatePolicy?.authentication === 'anonymous',
}
const pass = manifest.version === '0.2.1-rc.5' && Object.values(facts).every(Boolean)
const result = { kind: 'read-only static Desktop ASAR contract; no UI launch or authentication', desktopVersion: manifest.version, asarSha256: sha256, facts, pass }
const out = join(repo, 'docs', 'evidence', 'S05-native-welcome-contract')
await fs.mkdir(out, { recursive: true })
await fs.writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ desktopVersion: result.desktopVersion, facts, pass }))
if (!pass) process.exitCode = 1
