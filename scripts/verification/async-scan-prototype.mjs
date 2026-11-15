import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {parseMemory} from '../../src/store.ts';
import {inside,readRegular} from '../../src/storage-safety.ts';
const root=path.resolve(import.meta.dirname,'../..');
const base=path.join(root,'.work/S05');
const fixture=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('scale-')&&fs.existsSync(path.join(base,e.name,'2000/_user'))).at(-1);
if(!fixture)throw Error('Synthetic fixture missing');
const dir=path.join(base,fixture.name,'2000/_user');
const entries=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.name.endsWith('.md')&&e.name!=='MEMORY.md');
const results=[];
for(const concurrency of [1,8,16]){
 const durations=[];
 for(let pass=0;pass<3;pass++){
  let next=0,valid=0;const start=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
   for(;;){const index=next++;if(index>=entries.length)return;
    const entry=entries[index];if(!entry.isFile())throw Error('Unsafe entry');
    const file=inside(dir,entry.name);
    const raw=(await readRegular(file)).toString('utf8');
    const record=parseMemory(raw,'user');
    if(!record||record.name+'.md'!==entry.name)throw Error('Invalid record');valid++;
   }
  }));
  if(valid!==entries.length)throw Error('Lost records');durations.push(performance.now()-start);
 }
 results.push({concurrency,durationsMs:durations});
}
const output={status:'passed',count:entries.length,results,limitations:'Read-only feasibility experiment; excludes root marker and transaction lock checks, mutation races and host prompt API. Not production implementation or proof of full storage equivalence.'};
fs.writeFileSync(path.join(root,'docs/evidence/S05-profile/async-scan-prototype.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
