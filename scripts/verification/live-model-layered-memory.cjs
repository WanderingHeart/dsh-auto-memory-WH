// Installed rc.4 and packaged DSH host services; synthetic local HTTP only.
// Run with ELECTRON_RUN_AS_NODE=1 and the Desktop executable, so app.asar is readable.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
const modules = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/'
const testHome = process.argv[4] || 'installation-home', profile = process.argv[5] || 'wh-s05'
if (!/^[a-z][a-z0-9-]*$/.test(testHome) || !/^wh-[a-z0-9-]+$/.test(profile)) throw new Error('Invalid isolated target')
const installed = path.join(root, '.work/S05', testHome, 'profiles', profile, 'node_modules/dsh-auto-memory-wh')
const evidenceStage = 'S05-rc19-live-model'
const evidenceDir = path.join(root, 'docs/evidence', evidenceStage)
fs.mkdirSync(evidenceDir, { recursive: true })
const resume = process.argv.includes('--resume-verified-seed')
const scratch = resume ? path.join(root, '.work/S05/active-session-v8Wq1y') : fs.mkdtempSync(path.join(root, '.work/S05/active-session-'))
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key]
process.env.DSH_HOME = path.join(scratch, 'home')
const pkg = name => { const dir = modules + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main) }
const credentialFile = require('node:path').join(require('node:os').homedir(), '.dsh', '.credentials.yaml')
const originalCredentialBytes = fs.readFileSync(credentialFile)
const result = { status: 'running', installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, steps: [], boundary: 'Real deepseek-account/deepseek-flash; installed bundle; synthetic sessions and facts; scripted JSON retrieval via actual memory_read; no VM/UI or daily memory writes', modelCalls: 0, provider: 'deepseek-account', model: 'deepseek-flash' }
;(async () => {
  let ctx
  try {
    assert.equal(result.installedVersion, '1.0.0-rc.19')
    const code = fs.readFileSync(path.join(installed, 'lib/index.js'), 'utf8').replace(/from "(@deepseek-ai\/[^"/]+)"/g, (_, name) => { const hostDir = modules + name; const dir = fs.existsSync(hostDir + '/package.json') ? hostDir : path.join(root, 'node_modules', name); const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return 'from ' + JSON.stringify(pathToFileURL(dir + '/' + meta.main).href) })
    const bundle = path.join(scratch, 'plugin.mjs'); fs.writeFileSync(bundle, code)
    const { Context } = pkg('cordis'), { CredentialProvider } = pkg('dsh-credentials')
    class MemoryCredentials extends CredentialProvider {
      records = new Map(Object.entries(require(path.join(root,'node_modules/yaml')).parse(originalCredentialBytes.toString('utf8')).records).filter(([key]) => key.startsWith('deepseek-account-platform/')))
      async readRecord(key) { return this.records.get(key) }
      async deleteRecord(key) { this.records.delete(key) }
      async modifyRecord(key, fn) { const change = await fn(this.records.get(key)); if (change) this.records.set(key, change); return this.records.get(key) }
    }
    ctx = new Context()
    await ctx.plugin(MemoryCredentials, {})
    await ctx.plugin(pkg('dsh-authorization').default, {})
    await ctx.plugin(pkg('dsh-deepseek-account').default, {})
    await ctx.plugin(pkg('dsh-llm').default, {})
    await ctx.plugin(pkg('dsh-llm-deepseek-account'), {})
    await ctx.plugin(pkg('dsh-host-webserver').default, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(pkg('dsh-client-connection'), {})
    await ctx.plugin(pkg('dsh-system-prompt').default, {})
    await ctx.plugin(pkg('dsh-tools').default, {})
    await ctx.plugin(pkg('dsh-tool-executor-native'), {})
    await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href })
    await ctx.loader.create({ id: 'wh-active', name: pathToFileURL(bundle).href, config: { memoryDir: path.join(scratch, 'memory'), maxBytes: 65536, autoSummarizeMinTurns: 1, autoSummarizeMinChars: 0, autoSummarizeMaxMemories: 1, autoSummarizeMaxTokens: 2048, autoSummarizeIdleMinutes: 0, autoMerge: false } })
    await ctx.loader.await()
    const { BlockAssembler, createUserMessage, createSystemMessage } = pkg('dsh-llm')
    const projectA = path.join(scratch, 'ackermann'), projectB = path.join(scratch, 'other')
    fs.mkdirSync(projectA, {recursive:true}); fs.mkdirSync(projectB,{recursive:true})
    const fixtures = [
      {type:'user', marker:'U_VIOLET_731', topic:'图表', fact:'我的个人协作偏好是先看图表再听口头解释。在这个项目中，请使用专门的图表配色方案 U_VIOLET_731，这个方案只用于当前项目。请把一般偏好和项目专属配色细节一起保存为用户信息类型的项目级详细记忆，跨项目只保留一般偏好。'},
      {type:'feedback', marker:'F_AMBER_482', topic:'验证', fact:'我的反馈是：今后说明完成情况时先列验证证据，再给结论，因为之前没有证据的结论让我误判进度。本项目证据核查编号是 F_AMBER_482，仅这个项目使用。请把反馈原因及项目编号保存在反馈类型的项目级详细记忆，跨项目只保留先验证再下结论的经验。'},
      {type:'project', marker:'P_COBALT_619', topic:'阿克曼', fact:'我已完成阿克曼小车项目并完成了虚拟机验证。本项目使用的虚拟机环境标记是 P_COBALT_619，环境标记只属于这个项目。请保存项目类型的详细记忆；跨项目只记住我完成过阿克曼小车项目，不携带虚拟机环境标记。'},
      {type:'reference', marker:'R_JADE_857', topic:'手册', fact:'我经常参考车辆控制调试手册，它是以后其他项目也能使用的参考资料。本项目使用该手册的专属查阅定位符是 R_JADE_857，仅本项目适用。请把资源信息及定位符保存在参考资料类型的项目级详细记忆，跨项目只保留有车辆控制调试手册这个资源。'},
    ]
    const agent = (id,cwd) => ({session:{id,header:{cwd,delegationDepth:0}},options:{provider:'deepseek-account',model:'deepseek-flash',subagentDepth:0}})
    const query = async (name,args,who) => { for(let attempt=0;;attempt++){ try{return await ctx.tools.get(name).execute(args,{agent:who})}catch(error){if(attempt>=30 || !/busy|lock|recovery/i.test(String(error.message)))throw error;await new Promise(resolve=>setTimeout(resolve,200))}} }
    const wait = ms => new Promise(resolve=>setTimeout(resolve,ms))
    const generated=[]
    for(const f of fixtures) {
      const who=agent('live-seed-'+f.type,projectA);ctx.emit('agent/created',{agent:who})
      if(!resume) ctx.emit('session/event',who.session,{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:f.fact}]}})
      if(!resume) {ctx.emit('agent/disposed',{agent:who});result.modelCalls++}
      let detail,abstract
      const deadline=Date.now()+150000
      while(Date.now()<deadline) {
        const list=await query('memory_list',{scope:'project',type:f.type},who)
        if(list.memories.length) detail=await query('memory_read',{scope:'project',name:list.memories[0].name},who)
        const user=await query('memory_list',{scope:'user',type:f.type},who)
        if(user.memories.length) abstract=await query('memory_read',{scope:'user',name:user.memories[0].name},who)
        if(detail && abstract)break
        await wait(500)
      }
      assert.ok(detail && abstract, 'Two levels missing for '+f.type)
      assert.equal(detail.type,f.type);assert.equal(abstract.type,f.type)
      assert.ok((detail.body+detail.description).includes(f.marker),'detail marker missing '+f.type)
      for(const x of fixtures)assert.ok(!JSON.stringify(abstract).includes(x.marker),'abstract leaks '+x.type)
      generated.push({type:f.type,detail,abstract})
      result.steps.push({phase:'real summarization '+f.type,pass:true})
      console.log('PASS real summarization '+f.type)
    }
    result.generated=generated
    result.reusedVerifiedSeed=resume
    result.seedEvidence=resume ? "attempt-1.json (four actual model extractions)" : null
    async function infer(system,text) {
      result.modelCalls++
      const assembler=new BlockAssembler()
      for await(const chunk of ctx.llm.stream({provider:'deepseek-account',model:'deepseek-flash',messages:[createSystemMessage(system),createUserMessage({content:[{type:'text',text}],source:{kind:'wh-isolated-test'}})],maxTokens:2048,signal:AbortSignal.timeout(120000)}))assembler.push(chunk)
      assert.equal(assembler.finish.kind,'stop','real recall request did not finish')
      const response=assembler.blocks().filter(x=>x.type==='text').map(x=>x.text).join('')
      result.rawResponses ??= []; result.rawResponses.push(response)
      const begin=response.indexOf('{'), end=response.lastIndexOf('}');assert.ok(begin>=0 && end>begin,'recall JSON missing');return JSON.parse(response.slice(begin,end+1))
    }
    result.recalls=[]
    for(const [label,cwd] of [['same-project-new-session',projectA],['different-project',projectB]]) {
      const who=agent('live-recall-'+label,cwd);ctx.emit('agent/created',{agent:who})
      const assembled=await ctx.systemPrompt.assemble({agent:who})
      const index=assembled.sections.find(x=>x.name==='memory-wh:index')?.text||''
      if(label==='different-project')for(const f of fixtures)assert.ok(!index.includes(f.marker))
      const request=await infer('你在一个全新的会话里，下面是插件实际注入的记忆索引。只根据索引选择需要读取的记录，不能猜测。输出 JSON {"reads":[{"name":"记录名","scope":"user或project"}]}，最多8条。memory_read 的 name 参数为 kebab-case 记录名，不含 .md 扩展名；scope 只能是 user 或 project。\n'+index,'请找出我的图表偏好、验证反馈、阿克曼小车经历和调试手册资料相关记忆。需要具体细节时选择项目级记录。')
      assert.ok(Array.isArray(request.reads)&&request.reads.length<=8)
      const reads=[]
      for(const item of request.reads) {
        assert.ok(['user','project'].includes(item.scope)&&typeof item.name==='string')
        try { reads.push(await query('memory_read',{scope:item.scope,name:item.name},who)) } catch { reads.push({name:item.name,error:'NOT_FOUND'}) }
      }
      assert.equal(reads.filter(x=>x.body).length,4,'model did not successfully request all four records')
      const answer=await infer('只根据给定记忆回答，不要猜测未记录细节。输出 JSON，以 user、feedback、project、reference 为四个键，每项为 {"general":"一般事实","detail":"具体值；不知道填 unknown"}。类型对应：user=图表偏好和配色方案，feedback=验证反馈和证据编号，project=阿克曼经历和虚拟机标记，reference=调试手册和定位符。\n'+index+'\n读取结果：'+JSON.stringify(reads),'请分别复述四类信息。若只有一般概括就明确不知道项目专属标记。')
      result.recalls.push({label,index,requestedReads:request.reads,reads,answer})
      for(const f of fixtures){assert.ok(answer[f.type],label+' missing '+f.type);const text=JSON.stringify(answer[f.type]);if(label==='same-project-new-session')assert.ok(text.includes(f.marker),label+' forgot '+f.type);else {for(const x of fixtures)assert.ok(!text.includes(x.marker),'cross project leaked '+x.type);assert.match(answer[f.type].detail,/unknown|不知|未提供|没有|未记录/)} }
      result.steps.push({phase:label,pass:true});console.log('PASS '+label)
    }
    const crypto=require('node:crypto')
    result.archiveSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'.work/dsh-auto-memory-wh-1.0.0-rc.19.tgz'))).digest('hex')
    result.dailyCredentialsUnchanged=originalCredentialBytes.equals(fs.readFileSync(credentialFile))
    assert.ok(result.dailyCredentialsUnchanged)
    result.status = 'passed'
  } catch (error) { result.status = 'failed'; result.error = { name: error.name, code: error.code, message: String(error.message).slice(0,240) }; process.exitCode = 1 }
  finally { if (ctx) await ctx.fiber.dispose().catch(() => {}); fs.writeFileSync(path.join(evidenceDir, 'live-model-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)) }
})()
