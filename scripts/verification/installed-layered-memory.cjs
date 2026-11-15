// Installed rc.4 and packaged DSH host services; synthetic local HTTP only.
// Run with ELECTRON_RUN_AS_NODE=1 and the Desktop executable, so app.asar is readable.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
const modules = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/'
const testHome = process.argv[4] || 'installation-home', profile = process.argv[5] || 'wh-s05'
if (!/^[a-z][a-z0-9-]*$/.test(testHome) || !/^wh-[a-z0-9-]+$/.test(profile)) throw new Error('Invalid isolated target')
const installed = path.join(root, '.work/S05', testHome, 'profiles', profile, 'node_modules/dsh-auto-memory-wh')
const evidenceStage = 'S05-rc18-layered-host'
const evidenceDir = path.join(root, 'docs/evidence', evidenceStage)
fs.mkdirSync(evidenceDir, { recursive: true })
const scratch = fs.mkdtempSync(path.join(root, '.work/S05/active-session-'))
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key]
process.env.DSH_HOME = path.join(scratch, 'home')
const pkg = name => { const dir = modules + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main) }
const result = { status: 'running', installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, steps: [], boundary: 'Installed bundle with actual DSH host tools and prompt service, synthetic session objects and data; no live LLM, UI, VM or daily profile' }
;(async () => {
  let ctx
  try {
    assert.equal(result.installedVersion, '1.0.0-rc.18')
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
    await ctx.plugin(pkg('dsh-tool-executor-native'), {})
    await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href })
    await ctx.loader.create({ id: 'wh-active', name: pathToFileURL(bundle).href, config: { memoryDir: path.join(scratch, 'memory'), maxBytes: 65536, enableUserScope: true, autoSummarize: false } })
    await ctx.loader.await()
    const projectA = path.join(scratch, 'ackermann'), projectB = path.join(scratch, 'other')
    const agentA = { session: { id: 'synthetic-a1', header: { cwd: projectA } } }
    const agentA2 = { session: { id: 'synthetic-a2', header: { cwd: projectA } } }
    const agentB = { session: { id: 'synthetic-b', header: { cwd: projectB } } }
    for (const agent of [agentA, agentA2, agentB]) ctx.emit('agent/created', { agent })
    const write = ctx.tools.get('memory_write'), read = ctx.tools.get('memory_read')
    for (const type of ['user', 'feedback', 'project', 'reference']) {
      const args = { name: `layered-${type}`, scope: 'project', type,
        description: `PRIVATE_VM_DETAIL_${type}`, body: `PRIVATE_VM_DETAIL_${type}: synthetic environment`,
        userSummary: `User has reusable ${type} experience from an Ackermann car project.` }
      const resultA = await write.execute(args, { agent: agentA })
      assert.equal(resultA.userSummary, 'written')
      const sameProject = await read.execute({ name: args.name, scope: 'project' }, { agent: agentA2 })
      assert.ok(sameProject.body.includes('PRIVATE_VM_DETAIL_'))
      await assert.rejects(read.execute({ name: args.name, scope: 'project' }, { agent: agentB }), /NOT_FOUND/)
      result.steps.push({ phase: type, detailInSecondSession: true, detailIsolatedFromOtherProject: true, abstractSaved: true })
    }
    const promptA = (await ctx.systemPrompt.assemble({ agent: agentA2 })).sections.find(x => x.name === 'memory-wh:index').text
    const promptB = (await ctx.systemPrompt.assemble({ agent: agentB })).sections.find(x => x.name === 'memory-wh:index').text
    assert.ok(promptA.includes('PRIVATE_VM_DETAIL_'))
    assert.ok(!promptB.includes('PRIVATE_VM_DETAIL_'))
    for (const type of ['user', 'feedback', 'project', 'reference']) assert.ok(promptB.includes(`reusable ${type} experience`))
    result.steps.push({ phase: 'actual host prompt assembly', sameProjectDetails: true, otherProjectAbstractsOnly: true })
    const artifact = path.join(root, '.work', 'dsh-auto-memory-wh-1.0.0-rc.18.tgz')
    const crypto = require('node:crypto')
    result.archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex')
    result.installedBundleSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(installed, 'lib/index.js'))).digest('hex')
    result.status = 'passed'
  } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1 }
  finally { if (ctx) await ctx.fiber.dispose().catch(() => {}); fs.writeFileSync(path.join(evidenceDir, 'installed-layered-memory.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)) }
})()
