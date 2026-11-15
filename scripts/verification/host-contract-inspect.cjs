// Read only application code/metadata; never read the user's profile or credentials.
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
const dest = path.join(root, '.work/S05/host-reference'); fs.mkdirSync(dest, {recursive:true});
const names = fs.readdirSync(base).filter(n => /loader|plugin|profile|desktop-host|client-connection|client-store|web-app|host-webserver|credentials|app-boot|system-prompt|^dsh$|workspace|http|session|agent/.test(n));
const inventory = [];
for (const name of names) {
  const folder = path.join(base,name), meta = JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8'));
  inventory.push({name,version:meta.version,main:meta.main,types:meta.types});
  const out = path.join(dest,name); fs.mkdirSync(out,{recursive:true});
  if(name==='dsh') for(const f of fs.readdirSync(path.join(folder,'lib'))) if(f.endsWith('.js')) fs.writeFileSync(path.join(out,f),fs.readFileSync(path.join(folder,'lib',f)));
  for (const rel of ['package.json','README.md',meta.main,meta.types,...(name==='dsh'?['lib/bin.js']:[]),...(name==='dsh-desktop-host'?['lib/cli.js']:[])]) if(rel && fs.existsSync(path.join(folder,rel)) && fs.statSync(path.join(folder,rel)).isFile()) fs.writeFileSync(path.join(out,path.basename(rel)),fs.readFileSync(path.join(folder,rel)));
}
fs.writeFileSync(path.join(root,'docs/evidence/S05/host-contract-inventory.json'),JSON.stringify(inventory,null,2));
console.log(JSON.stringify(inventory,null,2));
