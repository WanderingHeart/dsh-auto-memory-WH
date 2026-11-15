const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'), modules='C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const pkg=n=>{const dir=modules+n;const p=JSON.parse(fs.readFileSync(dir+'/package.json','utf8'));return require(dir+'/'+p.main)};
const result={status:'running',checks:[],limitation:'Actual installed Cordis/SystemPrompt on synthetic context. No WH plugin, model call, official profile, or mutation-race proof.'};
(async()=>{let ctx;try{
 const {Context}=pkg('cordis'), promptModule=pkg('dsh-system-prompt');
 ctx=new Context();await ctx.plugin(promptModule.default,{});
 const events=[];let value='v1',count=0;
 ctx.systemPrompt.section({name:'wh-waterfall-probe',order:4000,text:()=>{events.push('sync-placeholder');return ''}});
 ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
  events.push('waterfall-enter');await Promise.resolve();
  const assembly=await next();const text=String(context.probeValue??value);count++;
  events.push('waterfall-read-'+text);
  return {...assembly,sections:assembly.sections.map(s=>s.name==='wh-waterfall-probe'?{...s,text}:s)};
 });
 const first=await ctx.systemPrompt.assemble({});
 assert.equal(first.sections.find(s=>s.name==='wh-waterfall-probe').text,'v1');
 assert.match(promptModule.renderPrompt(first),/v1/);
 assert.deepEqual(events,['sync-placeholder','waterfall-enter','waterfall-read-v1']);
 result.checks.push('synchronous empty section is replaced by awaited waterfall before render');
 value='v2';const second=await ctx.systemPrompt.assemble({});
 assert.equal(second.sections.find(s=>s.name==='wh-waterfall-probe').text,'v2');assert.equal(count,2);
 result.checks.push('each assemble reruns waterfall and observes changed synthetic value');
 const concurrent=await Promise.all(['scope-a','scope-b'].map(probeValue=>ctx.systemPrompt.assemble({probeValue})));
 assert.deepEqual(concurrent.map(item=>item.sections.find(s=>s.name==='wh-waterfall-probe').text),['scope-a','scope-b']);
 assert.equal(count,4);
 result.checks.push('two overlapping assemblies retain context-specific synthetic values');
 result.status='passed';
}catch(e){result.status='failed';result.error=e.stack;process.exitCode=1}finally{
 fs.mkdirSync(path.join(root,'docs/evidence/S05-profile'),{recursive:true});
 fs.writeFileSync(path.join(root,'docs/evidence/S05-profile/host-prompt-waterfall-probe.json'),JSON.stringify(result,null,2));
 if(ctx)await ctx.fiber.dispose();
 console.log(JSON.stringify(result));
}})();
