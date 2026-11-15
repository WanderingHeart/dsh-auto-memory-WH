import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const scratch=path.join(root,'.work/S05'), home=path.join(scratch,'installation-home');
const profile=path.join(home,'profiles/wh-s05'), memory=path.join(home,'memory-wh');
const evidence=path.join(root,'docs/evidence/S05');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function inventory(dir,prefix='') {return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{assert.ok(!e.isSymbolicLink()); const rel=prefix+e.name;return e.isDirectory()?inventory(path.join(dir,e.name),rel+'/'):[{path:rel,sha256:hash(fs.readFileSync(path.join(dir,e.name)))}]});}
const before=inventory(memory);
const backup=path.join(scratch,'pre-upgrade');
if(process.argv.includes('--resume')) {
 assert.deepEqual(inventory(path.join(backup,'memory-wh')),before,'Existing checkpoint differs; stop for inspection');
} else {
assert.ok(!fs.existsSync(backup),'Preserve existing checkpoint; use --resume after inspection');
fs.mkdirSync(backup);
fs.cpSync(memory,path.join(backup,'memory-wh'),{recursive:true,errorOnExist:true});
fs.mkdirSync(path.join(backup,'profile'));
for(const f of fs.readdirSync(profile)){if(fs.statSync(path.join(profile,f)).isFile())fs.copyFileSync(path.join(profile,f),path.join(backup,'profile',f));}
}
assert.deepEqual(inventory(path.join(backup,'memory-wh')),before);
const result={status:'running',dataBefore:before,steps:[],packages:{},limitation:'Stopped isolated wh-s05 profile only. Beta/RC share WH v1 review semantics; not an S03/upstream downgrade or real-data rollback.'};
const beta=path.join(root,'.work/dsh-auto-memory-wh-0.1.0-beta.0.tgz');
const rc=path.join(root,'.work/dsh-auto-memory-wh-0.1.0-rc.0.tgz');
for(const p of [beta,rc])result.packages[path.basename(p)]=hash(fs.readFileSync(p));
function run(label,phase,pack,expected=0){
 const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/verification/isolated-cli.ps1'),'-Phase',phase];
 if(pack)args.push('-Package',pack);
 const p=spawnSync('powershell.exe',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000});
 fs.writeFileSync(path.join(evidence,label+'.log'),(p.stdout||'')+'\n'+(p.stderr||''));
 assert.equal(p.error,undefined,p.error?.message);
 if(expected===0)assert.equal(p.status,0,label);else assert.notEqual(p.status,0,label);
 assert.deepEqual(inventory(memory),before,'Memory changed: '+label);
 result.steps.push({label,exitCode:p.status,memoryUnchanged:true});
 fs.writeFileSync(path.join(evidence,'isolated-lifecycle.json'),JSON.stringify(result,null,2));
 console.log(label+': passed');
}
function version(v){assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'node_modules/dsh-auto-memory-wh/package.json'))).version,v);}
try {
 run('upgrade-rc','Install',rc);version('0.1.0-rc.0');
 run('profile-rc','Dump');
 run('uninstall-rc','Remove');
 const removed=JSON.parse(fs.readFileSync(path.join(profile,'package.json')));
 assert.ok(!removed.dependencies?.['dsh-auto-memory-wh']);
 assert.ok(!removed.dsh.profile.bundles.includes('dsh-auto-memory-wh'));
 run('profile-uninstalled','Dump');
 assert.ok(!fs.readFileSync(path.join(evidence,'profile-uninstalled.log'),'utf8').includes('id: auto-memory-wh'));
 run('reinstall-rc-offline','Install',rc);version('0.1.0-rc.0');
 run('rollback-beta-offline','Install',beta);version('0.1.0-beta.0');
 run('restore-rc-offline','Install',rc);version('0.1.0-rc.0');
 const stable=fs.readFileSync(path.join(profile,'package.json'));
 const corrupt=path.join(scratch,'invalid-test.tgz');fs.writeFileSync(corrupt,'Intentionally invalid synthetic test archive.');
 run('invalid-package-rejected','Install',corrupt,1);
 assert.deepEqual(fs.readFileSync(path.join(profile,'package.json')),stable);
 version('0.1.0-rc.0');
 run('profile-after-rejection','Dump');
 result.dataAfter=inventory(memory);result.status='passed';
} catch(e){result.status='failed';result.error=e.stack;throw e;}
finally {fs.writeFileSync(path.join(evidence,'isolated-lifecycle.json'),JSON.stringify(result,null,2));}
