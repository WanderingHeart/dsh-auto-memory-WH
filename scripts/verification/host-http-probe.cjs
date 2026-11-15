// Actual packaged Connection, WebServer and Loader with an ephemeral credential provider.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname,'../..'), modules='C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const evidence=process.env.WH_EVIDENCE_FILE || path.join(root,'docs/evidence/S05/host-http-probe.json');
const scratch=fs.mkdtempSync(path.join(root,'.work/S05/http-'));
process.env.DSH_HOME=path.join(scratch,'home');
const pkg = n => {const dir=modules+'@deepseek-ai/'+n; const p=JSON.parse(fs.readFileSync(dir+'/package.json','utf8'));return require(dir+'/'+p.main)};
const result={status:'running',checks:[],limitation:'Actual packaged HTTP auth, route bridge and Cordis Loader. In-memory fresh credentials, synthetic agent lifecycle events, rewritten bundle imports. No official profile installation or real Desktop frontend.'};
(async()=>{
 let ctx;
 try {
  const {Context}=pkg('cordis'), {CredentialProvider}=pkg('dsh-credentials');
  class MemoryCredentials extends CredentialProvider {
   records=new Map();
   async modifyRecord(key,fn){const old=this.records.get(key);const change=await fn(old);if(change)this.records.set(key,change);return this.records.get(key)}
  }
  let code=fs.readFileSync(path.join(root,'lib/index.js'),'utf8');
  code=code.replace(/from "(@deepseek-ai\/[^"/]+)"/g,(_,name)=>{const dir=modules+name;const p=JSON.parse(fs.readFileSync(dir+'/package.json','utf8'));return 'from '+JSON.stringify(pathToFileURL(dir+'/'+p.main).href)});
  const bundle=path.join(scratch,'plugin.mjs');fs.writeFileSync(bundle,code);
  ctx=new Context();
  await ctx.plugin(MemoryCredentials,{});
  await ctx.plugin(pkg('dsh-host-webserver').default,{host:'127.0.0.1',port:0});
  await ctx.plugin(pkg('dsh-client-connection'),{});
  await ctx.plugin(pkg('dsh-system-prompt').default,{});
  await ctx.plugin(pkg('dsh-tools').default,{});
  await ctx.plugin(pkg('cordis-plugin-loader').default,{baseUrl:pathToFileURL(scratch+'/').href});
  const settings={memoryDir:path.join(scratch,'memory'),autoSummarize:false,maxBytes:4096,enableUserScope:true};
  await ctx.loader.create({id:'wh-test',name:pathToFileURL(bundle).href,config:settings});
  await ctx.loader.await();
  assert.equal(ctx.tools.schemas().filter(s=>s.name.startsWith('memory_')).length,5);
  result.checks.push('actual Loader activates the plugin and its five tools');
  ctx.webServer.register({kind:'exact',path:'/',handler:(req,res)=>{if(ctx.connection.authorizeIndex(req,res)) {res.writeHead(200);res.end('synthetic probe')}}});
  const origin=ctx.webServer.getOrigin(), route=origin+'/api/auto-memory-wh/';
  const login=await fetch(ctx.connection.authenticatedUrl(origin+'/'),{redirect:'manual'});
  assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=(name,data,method='GET',headers={})=>fetch(route+name+(method==='GET'?'?'+new URLSearchParams(data):''),{method,headers:{cookie,'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(data)}:{})});
  assert.equal((await fetch(route+'groups.list?scope=user')).status,401);
  assert.equal((await call('groups.list',{scope:'user'},'GET',{origin:'https://untrusted.invalid'})).status,403);
  assert.equal((await call('groups.list',{scope:'user'},'GET',{cookie:'invalid=1'})).status,401);
  assert.equal((await call('groups.list',{scope:'user'})).status,200);
  result.checks.push('real login cookie required; missing/tampered cookies and cross-origin requests rejected');
  const agent={session:{id:'synthetic-session',header:{cwd:path.join(scratch,'project')}}};
  assert.equal((await call('groups.list',{scope:'project',sessionId:agent.session.id})).status,403);
  ctx.emit('agent/created',{agent});
  const data={scope:'project',sessionId:agent.session.id,name:'synthetic-record',description:'synthetic safe fact',type:'project',body:'No user data.',expectedRevision:null};
  const created=await call('memory.write',data,'POST'); assert.equal(created.status,200);const first=(await created.json()).record;
  assert.equal(first.status,'candidate');
  const review=await call('memory.review',{scope:'project',sessionId:agent.session.id,name:data.name,expectedRevision:first.revision,status:'verified',confirm:true},'POST');assert.equal(review.status,200);
  const section=(await ctx.systemPrompt.assemble({agent})).sections.find(s=>s.name==='memory-wh:index');assert.match(section.text,/synthetic-record/);
  assert.equal((await call('memory.write',{...data,expectedRevision:first.revision,body:'stale edit'},'POST')).status,409);
  assert.equal((await call('groups.list',{scope:'project',sessionId:'different'})).status,403);
  result.checks.push('actual HTTP bridge supports review, strict project scope, prompt inclusion and 409 conflicts');
  ctx.emit('session/disposed',agent.session);
  assert.equal((await call('groups.list',{scope:'project',sessionId:agent.session.id})).status,403);
  await ctx.loader.remove('wh-test');await ctx.loader.await();
  assert.equal((await call('groups.list',{scope:'user'})).status,404);
  assert.equal(ctx.tools.schemas().filter(s=>s.name.startsWith('memory_')).length,0);
  await ctx.loader.create({id:'wh-test',name:pathToFileURL(bundle).href,config:settings});await ctx.loader.await();
  ctx.emit('agent/created',{agent});
  const listed=await call('groups.list',{scope:'project',sessionId:agent.session.id});assert.equal(listed.status,200);assert.equal((await listed.json()).total,1);
  assert.match((await ctx.systemPrompt.assemble({agent})).sections.find(s=>s.name==='memory-wh:index').text,/synthetic-record/);
  result.checks.push('session disposal revokes project mapping; Loader unload/remount removes routes and tools while retaining reviewed data');
  result.status='passed';
 }catch(e){result.status='failed';result.error={message:e.message,stack:e.stack};process.exitCode=1}
 finally{if(ctx)await ctx.fiber.dispose();fs.writeFileSync(evidence,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
})();
