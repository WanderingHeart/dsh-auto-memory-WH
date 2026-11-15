import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { MemoryStore, serializeMemory, reviewFingerprint } from '../../src/store.ts'
import { renderMemoryIndexDetail } from '../../src/injection.ts'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const scratch=await fs.mkdtemp(path.join(root,'.work/S05/scale-'))
const samples=[]
for(const count of [0,1,6,100,2000]) {
 const data=path.join(scratch,String(count)), store=new MemoryStore(data)
 await fs.mkdir(path.join(data,'_user'),{recursive:true})
 await fs.writeFile(path.join(data,'.wh-format.json'),JSON.stringify({format:'dsh-auto-memory-wh',version:1}))
 for(let i=0;i<count;i++) {
  const record={name:'synthetic-'+String(i).padStart(4,'0'),title:'合成测试 🧠 '+i,description:'合成 memory fact 中文🙂 '.repeat(3),body:'Synthetic body. '.repeat(20),type:'reference',scope:'user',status:'verified',createdMs:1793664000000,updatedMs:1793664000000,reviewHash:''}
  record.reviewHash=reviewFingerprint(record)
  await fs.writeFile(path.join(data,'_user',record.name+'.md'),serializeMemory(record))
 }
 const durations=[], config={maxBytes:4096,enableUserScope:true,staleAfterDays:0};let previous,detail
 for(let i=0;i<5;i++){const start=performance.now();detail=renderMemoryIndexDetail(store,config,scratch,'合成');durations.push(performance.now()-start);assert.ok(detail.textBytes<=4096);if(previous!==undefined)assert.equal(previous,detail.text);previous=detail.text}
 const start=performance.now(), listed=await store.list('user'), listMs=performance.now()-start;assert.equal(listed.length,count)
 durations.sort((a,b)=>a-b)
 samples.push({count,renderP50Ms:durations[2],renderMaxMs:durations[4],listMs,bytes:detail.textBytes,selected:detail.records.length,excluded:detail.excluded.length})
}
const report={status:'passed',node:process.version,cpu:os.cpus()[0]?.model,platform:process.platform,iterations:5,samples,limitations:'Synthetic local warm/cold mixed timing; not a full UI/request latency or cold-boot benchmark. Does not measure LLM tokens.',rssBytes:process.memoryUsage().rss}
await fs.writeFile(path.join(root,'docs/evidence/S05/scale-probe.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
