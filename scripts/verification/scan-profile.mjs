import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {parseMemory} from '../../src/store.ts';
import {inside} from '../../src/storage-safety.ts';
const root=path.resolve(import.meta.dirname,'../..');
const base=path.join(root,'.work/S05');
const fixture=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('scale-')&&fs.existsSync(path.join(base,e.name,'2000/_user'))).at(-1);
if(!fixture)throw Error('Synthetic fixture missing');
const directory=path.join(base,fixture.name,'2000/_user');
const entries=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.name.endsWith('.md')&&e.name!=='MEMORY.md');
const samples=[];
for(let pass=0;pass<5;pass++){
 const times={insideMs:0,statMs:0,readMs:0,parseMs:0}, start=performance.now();let valid=0;
 for(const entry of entries){
  let t=performance.now();const file=inside(directory,entry.name);times.insideMs+=performance.now()-t;
  t=performance.now();const stat=fs.lstatSync(file);times.statMs+=performance.now()-t;
  if(!entry.isFile()||!stat.isFile()||stat.size>1048576)throw Error('Unsafe fixture');
  t=performance.now();const raw=fs.readFileSync(file,'utf8');times.readMs+=performance.now()-t;
  t=performance.now();const record=parseMemory(raw,'user');times.parseMs+=performance.now()-t;
  if(!record||record.name+'.md'!==entry.name)throw Error('Invalid fixture');valid++;
 }
 samples.push({pass:pass+1,totalMs:performance.now()-start,...times,valid});
}
const output={status:'passed',count:entries.length,samples,limitations:'Instrumented reproduction of the per-file loop, excluding directory/marker/lock checks and injection. Timings include performance.now overhead; not an exact attribution of scanSync. Uses only synthetic files.'};
fs.mkdirSync(path.join(root,'docs/evidence/S05-profile'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/evidence/S05-profile/scan-profile.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
