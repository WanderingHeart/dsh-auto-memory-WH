import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stage = process.argv[2] || 'S03'
if (!/^S[0-9]+$/.test(stage)) throw new Error('Invalid stage')
const sandbox = fs.mkdtempSync(path.join(root, '.work', 's03-cli-'))
const source = path.join(sandbox, 'source')
fs.mkdirSync(path.join(source, '_user'), { recursive: true })
const original = '---\nname: synthetic\ndescription: synthetic CLI fixture\ntype: reference\nfutureField:\n  preserved: true\n---\n\nNo real memory used.\n'
fs.writeFileSync(path.join(source, '_user', 'synthetic.md'), original)
let requestNumber = 0
function run(command, body) {
  const request = path.join(sandbox, 'request-' + (++requestNumber) + '.json')
  fs.writeFileSync(request, JSON.stringify(body))
  const proc = spawnSync(process.execPath, [path.join(root, 'lib/maintenance-cli.js'), command, request], { encoding: 'utf8', windowsHide: true })
  assert.equal(proc.status, 0, proc.stderr)
  return JSON.parse(proc.stdout)
}
const target = path.join(sandbox, 'migrated'), backup = path.join(sandbox, 'backup')
const selection = { includeAudit: false, includeArchive: true }
const plan = run('plan', { source, target, backup, selection })
assert.deepEqual(plan.inventory.issues, [])
assert.equal(fs.existsSync(target), false)
const applied = run('apply', { plan, options: { approvedPlanHash: plan.hash, writersStopped: true } })
assert.match(applied.status, /copied-and-verified/)
assert.equal(fs.readFileSync(path.join(target, '_user', 'synthetic.md'), 'utf8'), original)
const verified = run('verify', { file: path.join(backup, 'snapshot.json'), expectedHash: applied.backupHash })
assert.equal(verified.verified, true)
const restored = path.join(sandbox, 'restored')
run('restore', { file: path.join(backup, 'snapshot.json'), expectedHash: applied.backupHash, destination: restored })
assert.equal(fs.readFileSync(path.join(restored, '_user', 'synthetic.md'), 'utf8'), original)
assert.equal(fs.readFileSync(path.join(source, '_user', 'synthetic.md'), 'utf8'), original)
const result = { status: 'passed', node: process.version, checks: ['built CLI plans without target writes', 'built CLI applies approved offline migration', 'source and copied record bytes preserved', 'backup checksum verified', 'backup restored to a new directory'], limitation: 'Synthetic local data only; no DSH configuration switch or real plugin installation.' }
fs.writeFileSync(path.join(root, `docs/evidence/${stage}/maintenance-cli-smoke.json`), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
