// Seed one synthetic persisted session without a model call. Electron Node only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..'), testRoot = path.join(root, '.work/S05')
const mode = process.argv[2]
assert.ok(['rehearse', 'native'].includes(mode), 'Use rehearse or native')
const home = mode === 'native' ? path.join(testRoot, 'native-real-user-home') : fs.mkdtempSync(path.join(testRoot, 'native-audit-session-rehearsal-r72-'))
const sessions = path.join(home, 'sessions'), cwd = path.join(home, 'synthetic-audit-workspace')
const evidenceDir = path.join(root, 'docs/evidence/S05-native-audit-readiness')
const pointer = path.join(testRoot, 'native-audit-session-pointer-r72.json')
const sha = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase()
const previous = []
function collect(dir) {
 if (!fs.existsSync(dir)) return
 for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
  const file = path.join(dir, item.name)
  if (item.isSymbolicLink()) throw new Error('Refusing linked session path')
  if (item.isDirectory()) collect(file)
  else if (item.isFile()) previous.push({ path: path.relative(sessions, file), sha256: sha(fs.readFileSync(file)) })
 }
}
if (mode === 'native') {
 assert.equal(sha(fs.readFileSync(path.join(home, '.credentials.yaml'))), '9FF947C05D4EDAD0728B1DD929C8C9D02DBB5167382AF51DD20189B2B1708296')
 assert.ok(fs.existsSync(path.join(home, 'profiles/desktop/package.json')))
 assert.ok(!fs.existsSync(pointer), 'Native audit session was already seeded')
 collect(sessions)
 const backup = path.join(testRoot, 'native-audit-session-baseline-r72')
 assert.ok(!fs.existsSync(backup), 'Session backup already exists')
 fs.cpSync(sessions, backup, { recursive: true, errorOnExist: true, force: false })
 for (const old of previous) assert.equal(sha(fs.readFileSync(path.join(backup, old.path))), old.sha256)
} else fs.mkdirSync(sessions, { recursive: true })
fs.mkdirSync(cwd, { recursive: true })
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key]
process.env.DSH_HOME = home
const result = { status: 'running', mode, previousSessionFiles: previous.length, modelCalls: 0, networkAttempts: 0 }
const deny = () => { result.networkAttempts++; throw new Error('NETWORK_BLOCKED_IN_SYNTHETIC_SEED') }
globalThis.fetch = deny
for (const name of ['node:http', 'node:https']) { const mod = require(name); mod.request = deny; mod.get = deny }
const net = require('node:net'); net.connect = deny; net.createConnection = deny
require('node:tls').connect = deny; require('node:dgram').createSocket = deny
const base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/'
const pkg = name => { const dir = base + name, meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main) }
;(async () => {
 let ctx, owned
 try {
  const { Context } = pkg('cordis'); ctx = new Context()
  await ctx.plugin(pkg('dsh-session-projection').default, {})
  await ctx.plugin(pkg('dsh-session').default, {})
  await ctx.plugin(pkg('dsh-session-persistence-jsonl'), { root: sessions })
  await ctx.plugin(pkg('dsh-agent').default, {})
  await ctx.plugin(pkg('dsh-system-prompt').default, {})
  await ctx.plugin(pkg('dsh-tools').default, {})
  ctx.provide('llm', { async *stream() { result.modelCalls++; throw new Error('MODEL_MUST_NOT_RUN') } })
  await ctx.plugin(pkg('dsh-agent-loop').default, { agents: [], maxParallelToolCalls: 10 })
  const id = crypto.randomUUID()
  owned = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'wh-local-fake', model: 'synthetic' }, meta: { cwd } })
  const session = owned.agent.session
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: 'WH 原生隔离审计合成会话 r72。' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await ctx.sessions.flush(session)
  assert.equal(session.header.cwd, cwd)
  assert.equal(result.modelCalls, 0)
  if (mode === 'native') {
   for (const old of previous) assert.equal(sha(fs.readFileSync(path.join(sessions, old.path))), old.sha256)
   fs.writeFileSync(pointer, JSON.stringify({ id, cwd, home }, null, 2) + '\n', { flag: 'wx' })
  }
  result.sessionId = id; result.cwdWithinTestRoot = cwd.startsWith(testRoot + path.sep); result.events = session.snapshotEvents().length
  assert.ok(result.cwdWithinTestRoot && result.events >= 5)
  result.status = 'passed'
 } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1 }
 finally {
  if (owned) await owned.dispose().catch(() => {})
  if (ctx) await ctx.fiber.dispose().catch(() => {})
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(path.join(evidenceDir, mode + '-session.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
 }
})()
