import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {MemoryStore} from '../../src/store.ts';
import {renderMemoryIndexDetail} from '../../src/injection.ts';
const root=path.resolve(import.meta.dirname,'../..');
const candidates=fs.readdirSync(path.join(root,'.work/S05'),{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('scale-')&&fs.existsSync(path.join(root,'.work/S05',e.name,'2000/_user')));
if(!candidates.length)throw new Error('No synthetic scale fixture');
const fixture=path.join(root,'.work/S05',candidates.at(-1).name,'2000');
const store=new MemoryStore(fixture);
const original=store.scanSync.bind(store);
const samples=[];
for(let i=0;i<5;i++){
 let scanMs=0,scans=0;
 store.scanSync=(...args)=>{const start=performance.now();const value=original(...args);scanMs+=performance.now()-start;scans++;return value};
 const start=performance.now();const detail=renderMemoryIndexDetail(store,{maxBytes:4096,enableUserScope:true,staleAfterDays:0},fixture,'合成');const totalMs=performance.now()-start;
 samples.push({totalMs,scanMs,otherMs:totalMs-scanMs,scans,bytes:detail.textBytes,selected:detail.records.length});
}
const report={status:'passed',count:2000,samples,method:'Wrapped MemoryStore.scanSync in the actual synchronous render. scanMs includes path validation, stat, read and parse; otherMs includes sorting, escaping, budgeting and output. Five repeated runs on existing synthetic fixture; no real memory.',limitations:'Instrumentation overhead and filesystem cache affect absolute timings. Not per-file I/O breakdown or end-to-end request latency.'};
fs.mkdirSync(path.join(root,'docs/evidence/S05-profile'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/evidence/S05-profile/scale-profile.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
