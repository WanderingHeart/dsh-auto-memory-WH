// Read installed WH and wh-s05 synthetic memory through packaged prompt assembly.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),home=path.join(root,'.work/S05/installation-home');
const installed=path.join(home,'profiles/wh-s05/node_modules/dsh-auto-memory-wh');
const base='C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const mode=process.argv[2];assert.ok(['reviewed','muted'].includes(mode));
for(const key of Object.keys(process.env))if(/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key))delete process.env[key];
process.env.DSH_HOME=home;
const pkg=name=>{const dir=base+'@deepseek-ai/'+name,meta=JSON.parse(fs.readFileSync(dir+'/package.json','utf8'));return require(dir+'/'+meta.main)};
const scratch=fs.mkdtempSync(path.join(root,'.work/S05/profile-injection-'));
const source=fs.readFileSync(path.join(installed,'lib/index.js'),'utf8');
const rewritten=source.replace(/from "(@deepseek-ai\/[^"/]+)"/g,(_,name)=>{const dir=base+name,meta=JSON.parse(fs.readFileSync(dir+'/package.json','utf8'));return 'from '+JSON.stringify(pathToFileURL(dir+'/'+meta.main).href)});
const bundle=path.join(scratch,'plugin.mjs');fs.writeFileSync(bundle,rewritten);
const evidence=path.join(root,'docs/evidence/S05-rc3-ui-review');fs.mkdirSync(evidence,{recursive:true});
const result={status:'running',mode,installedVersion:JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8')).version,bundleSha256:crypto.createHash('sha256').update(source).digest('hex')};
(async()=>{let ctx;try{
 const {Context}=pkg('cordis');ctx=new Context();
 await ctx.plugin(pkg('dsh-system-prompt').default,{});
 await ctx.plugin(pkg('dsh-tools').default,{});
 await ctx.plugin(pkg('cordis-plugin-loader').default,{baseUrl:pathToFileURL(scratch+'/').href});
 await ctx.loader.create({id:'wh-review',name:pathToFileURL(bundle).href,config:{memoryDir:path.join(home,'memory-wh'),maxBytes:4096,enableUserScope:true,autoSummarize:false,staleAfterDays:0}});await ctx.loader.await();
 const cwd=path.join(home,'synthetic-documents/deepseek-harness/default-workspace');
 const agent={session:{id:'synthetic-review-check-'+mode,header:{cwd}}};
 const section=(await ctx.systemPrompt.assemble({agent})).sections.find(x=>x.name==='memory-wh:index')?.text??'';
 const present=section.includes('s05-browser-review');assert.equal(present,mode==='reviewed');
 result.reviewedRecordPresent=present;result.bytes=Buffer.byteLength(section);result.status='passed';
 }catch(error){result.status='failed';result.error={message:error.message,stack:error.stack};process.exitCode=1}
 finally{if(ctx)await ctx.fiber.dispose().catch(()=>{});fs.writeFileSync(path.join(evidence,mode+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}})();
