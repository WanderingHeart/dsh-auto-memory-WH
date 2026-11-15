import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..');
const pkg=path.join(root,'package.json'),lock=path.join(root,'package-lock.json');
const manifest=JSON.parse(fs.readFileSync(pkg,'utf8'));
assert.equal(manifest.version,'0.1.0-rc.0');
manifest.version='0.1.0-rc.1';fs.writeFileSync(pkg,JSON.stringify(manifest,null,2)+'\n');
const locked=JSON.parse(fs.readFileSync(lock,'utf8'));
assert.equal(locked.version,'0.1.0-rc.0');locked.version=locked.packages[''].version='0.1.0-rc.1';fs.writeFileSync(lock,JSON.stringify(locked,null,2)+'\n');
for(const rel of ['src/audit-log.ts','src/maintenance.ts','src/storage-safety.ts']){
 const file=path.join(root,rel),old=fs.readFileSync(file,'utf8'),next=old.replaceAll('0.1.0-rc.0','0.1.0-rc.1');
 assert.notEqual(old,next,rel);fs.writeFileSync(file,next);
}
for(const [rel,from,to] of [
 ['README.md','Current version: **0.1.0-rc.0**','Current version: **0.1.0-rc.1**'],
 ['README.zh.md','当前版本 **0.1.0-rc.0**','当前版本 **0.1.0-rc.1**']]){
 const file=path.join(root,rel),old=fs.readFileSync(file,'utf8');assert.ok(old.includes(from));fs.writeFileSync(file,old.replace(from,to));
}
const change=path.join(root,'CHANGELOG.md'),old=fs.readFileSync(change,'utf8');
assert.ok(old.includes('## [Unreleased] — 0.1.0-rc.0'));
fs.writeFileSync(change,old.replace('## [Unreleased] — 0.1.0-rc.0',`## [Unreleased] — 0.1.0-rc.1

### Changed

- 记忆注入改经宿主异步组装事件读取当前源文件，限并发扫描、逐文件验证，保留原审核、范围、转义和最终字节预算。
- 任一启用范围存储不可用时整段零字节，并在逐次组装审计中记录原因。
- 网络断连提示改为中文；编辑器说明区分列表刷新与整个网页刷新。

### Validation boundaries

- 隔离开发回归 267 项通过；真实模型压缩/子代理与日常配置仍未验收，G4 未通过。
- 该候选版仅用于 wh-s05 本地隔离安装，不代表公开发行。

## [0.1.0-rc.0] — S05 本地候选快照，未发布`));
