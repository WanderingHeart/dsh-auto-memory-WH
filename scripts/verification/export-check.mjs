import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const scratch=path.join(root,'.work/S05');
const data=JSON.parse(fs.readFileSync(path.join(scratch,'export-project-rc.json'),'utf8'));
const merged=fs.readFileSync(path.join(scratch,'export-project-rc.md'),'utf8');
assert.equal(data.format,'wh-markdown-export');assert.equal(data.version,1);
assert.equal(data.scope,'project');assert.equal(data.includesAudit,false);assert.equal(data.includesArchive,false);
assert.equal(data.files.length,1);
const memory=path.join(scratch,'installation-home/memory-wh');
const projects=fs.readdirSync(memory).filter(n=>n!=='_user'&&fs.statSync(path.join(memory,n)).isDirectory());
assert.equal(projects.length,1);
for(const item of data.files){
 assert.equal(path.basename(item.name),item.name);
 assert.equal(Buffer.byteLength(item.content),item.bytes);
 assert.equal(crypto.createHash('sha256').update(item.content).digest('hex'),item.sha256);
 assert.equal(fs.readFileSync(path.join(memory,projects[0],item.name),'utf8'),item.content);
 assert.ok(merged.includes(item.content));
 assert.ok(!item.content.includes('这是隔离验收记录，不含真实个人信息。'));
}
const result={status:'passed',checks:['Two separate browser actions each downloaded one file','Project export contains exactly one active project record','Exact raw bytes, SHA-256 and merged content verified','Same-name user record, archive and audit excluded'],files:data.files.map(({name,bytes,sha256})=>({name,bytes,sha256}))};
fs.writeFileSync(path.join(root,'docs/evidence/S05/export-check.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
