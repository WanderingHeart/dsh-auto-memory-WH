// Installed rc.4 and packaged DSH host services; synthetic local HTTP only.
// Run with ELECTRON_RUN_AS_NODE=1 and the Desktop executable, so app.asar is readable.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
const modules = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/'
const testHome = process.argv[4] || 'installation-home', profile = process.argv[5] || 'wh-s05'
if (!/^[a-z][a-z0-9-]*$/.test(testHome) || !/^wh-[a-z0-9-]+$/.test(profile)) throw new Error('Invalid isolated target')
const installed = path.join(root, '.work/S05', testHome, 'profiles', profile, 'node_modules/dsh-auto-memory-wh')
const evidenceStage = process.argv[3] || 'S05-rc4-lifecycle'
if (!/^S05-(?:rc[0-9]+|\d+\.\d+\.\d+)(?:-lifecycle|-fault|-acl)?$/.test(evidenceStage)) throw new Error('Invalid evidence stage')
const evidenceDir = path.join(root, 'docs/evidence', evidenceStage)
fs.mkdirSync(evidenceDir, { recursive: true })
const scratch = fs.mkdtempSync(path.join(root, '.work/S05/active-session-'))
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key]
process.env.DSH_HOME = path.join(scratch, 'home')
const pkg = name => { const dir = modules + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main) }
const result = { status: 'running', installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, steps: [], boundary: 'Synthetic root, local HTTP, no model or daily profile' }
;(async () => {
  let ctx
  try {
    assert.equal(result.installedVersion, process.argv[2] || '0.1.0-rc.4')
    const code = fs.readFileSync(path.join(installed, 'lib/index.js'), 'utf8').replace(/from "(@deepseek-ai\/[^"/]+)"/g, (_, name) => { const hostDir = modules + name; const dir = fs.existsSync(hostDir + '/package.json') ? hostDir : path.join(root, 'node_modules', name); const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return 'from ' + JSON.stringify(pathToFileURL(dir + '/' + meta.main).href) })
    const bundle = path.join(scratch, 'plugin.mjs'); fs.writeFileSync(bundle, code)
    const { Context } = pkg('cordis'), { CredentialProvider } = pkg('dsh-credentials')
    class MemoryCredentials extends CredentialProvider {
      records = new Map()
      async modifyRecord(key, fn) { const change = await fn(this.records.get(key)); if (change) this.records.set(key, change); return this.records.get(key) }
    }
    ctx = new Context()
    await ctx.plugin(MemoryCredentials, {})
    await ctx.plugin(pkg('dsh-host-webserver').default, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(pkg('dsh-client-connection'), {})
    await ctx.plugin(pkg('dsh-system-prompt').default, {})
    await ctx.plugin(pkg('dsh-tools').default, {})
    await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href })
    await ctx.loader.create({ id: 'wh-active', name: pathToFileURL(bundle).href, config: { memoryDir: path.join(scratch, 'memory'), maxBytes: 4096, enableUserScope: true, autoSummarize: false } })
    await ctx.loader.await()
    ctx.webServer.register({ kind: 'exact', path: '/', handler: (req, res) => { if (ctx.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('synthetic active session probe') } } })
    const origin = ctx.webServer.getOrigin()
    const login = await fetch(ctx.connection.authenticatedUrl(origin + '/'), { redirect: 'manual' })
    assert.equal(login.status, 303)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const route = origin + '/api/auto-memory-wh/'
    const call = (name, data = {}, authenticated = true) => fetch(route + name + '?' + new URLSearchParams(data), { headers: authenticated ? { cookie } : {} })
    const active = async () => { const response = await call('sessions.active'); assert.equal(response.status, 200); return (await response.json()).sessions }
    const old = { session: { id: 'synthetic-old-session', header: { cwd: path.join(scratch, 'project') } } }
    const fresh = { session: { id: 'synthetic-new-session', header: { cwd: old.session.header.cwd } } }
    assert.equal((await call('sessions.active', {}, false)).status, 401)
    assert.deepEqual(await active(), [])
    assert.equal((await call('groups.list', { scope: 'project', sessionId: old.session.id })).status, 403)
    result.steps.push({ phase: 'before agent creation', active: [], oldProjectStatus: 403 })
    ctx.emit('agent/created', { agent: old })
    assert.deepEqual((await active()).map(item => item.id), [old.session.id])
    assert.equal((await call('groups.list', { scope: 'project', sessionId: old.session.id })).status, 200)
    result.steps.push({ phase: 'old agent active', active: [old.session.id], oldProjectStatus: 200 })
    ctx.emit('session/disposed', old.session)
    assert.deepEqual(await active(), [])
    assert.equal((await call('groups.list', { scope: 'project', sessionId: old.session.id })).status, 403)
    assert.equal((await call('groups.list', { scope: 'user' })).status, 200)
    result.steps.push({ phase: 'old session disposed', active: [], oldProjectStatus: 403, userStatus: 200 })
    ctx.emit('agent/created', { agent: fresh })
    assert.deepEqual((await active()).map(item => item.id), [fresh.session.id])
    assert.equal((await call('groups.list', { scope: 'project', sessionId: old.session.id })).status, 403)
    assert.equal((await call('groups.list', { scope: 'project', sessionId: fresh.session.id })).status, 200)
    result.steps.push({ phase: 'new agent active', active: [fresh.session.id], oldProjectStatus: 403, newProjectStatus: 200 })
    result.status = 'passed'
  } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1 }
  finally { if (ctx) await ctx.fiber.dispose().catch(() => {}); fs.writeFileSync(path.join(evidenceDir, 'installed-host-lifecycle.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)) }
})()
