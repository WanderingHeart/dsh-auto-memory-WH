const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const asar = 'C:/DeepSeek Harness/resources/app.asar';
const modules = asar + '/dsh/node_modules/';
const stage = process.argv[2] || 'S02';
if (!/^S[0-9]+$/.test(stage)) throw new Error('Invalid stage');
const evidence = path.join(root, 'docs/evidence', stage);
fs.mkdirSync(evidence, {recursive:true});
fs.mkdirSync(path.join(root, '.work'), {recursive:true});
const hostJson = JSON.parse(fs.readFileSync(asar + '/package.json', 'utf8'));
const names = ['cordis', 'schemastery', 'dsh-agent', 'dsh-atomic-write', 'dsh-home-paths', 'dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-client-connection', 'dsh-client-ui-slots', 'dsh-client-ui-sidebar'];
const packages = {};
for (const n of names) {
  const metaPath = modules + '@deepseek-ai/' + n + '/package.json';
  if (!fs.existsSync(metaPath)) { packages['@deepseek-ai/' + n] = {missingAtHostPath:true}; continue; }
  const p = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  packages[p.name] = {version:p.version, main:p.main, types:p.types, license:p.license};
}
const result = {host:hostJson, runtime:process.versions, packages, checks:[], limitation:'Direct host-service probe with rewritten imports; does not exercise Desktop plugin loader, Web UI, or real profile.'};
const probeRoot = fs.mkdtempSync(path.join(root, '.work', 'host-probe-'));
process.env.DSH_HOME = path.join(probeRoot, 'dsh-home');
const pkg = n => require(modules + '@deepseek-ai/' + n + '/' + packages['@deepseek-ai/' + n].main);
(async () => {
  let ctx;
  try {
    const { Context } = pkg('cordis');
    const prompt = pkg('dsh-system-prompt');
    const tools = pkg('dsh-tools');
    const home = pkg('dsh-home-paths');
    assert.equal(home.resolveDshHome(), process.env.DSH_HOME);
    result.checks.push('actual host home resolver honors isolated DSH_HOME');
    let code = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8');
    result.pluginBundleSha256 = crypto.createHash('sha256').update(code).digest('hex');
    code = code.replace(/from "(@deepseek-ai\/[^"/]+)"/g, (_, name) => {
      const info = packages[name];
      if (!info) throw new Error('Unmapped host dependency: ' + name);
      return 'from ' + JSON.stringify(pathToFileURL(modules + name + '/' + info.main).href);
    });
    const probeFile = path.join(probeRoot, 'plugin.mjs');
    fs.writeFileSync(probeFile, code);
    const plugin = await import(pathToFileURL(probeFile).href);
    ctx = new Context();
    await ctx.plugin(prompt.default, {});
    await ctx.plugin(tools.default, {});
    const fiber = await ctx.plugin(plugin, {maxBytes:4096,memoryDir:path.join(probeRoot,'memory'),enableUserScope:true,autoSummarize:false,autoSummarizeMaxMemories:5,autoSummarizeMaxTokens:2048,minImportance:4,staleAfterDays:0});
    const toolNames = ctx.tools.schemas().map(x=>x.name);
    for (const n of ['memory_write','memory_read','memory_list','memory_search','memory_delete']) assert.ok(toolNames.includes(n));
    result.tools = toolNames;
    result.checks.push('five required tools register against actual host services');
    const agent = {session:{header:{cwd:probeRoot},id:'wh-synthetic'}};
    const write = ctx.tools.get('memory_write');
    await write.execute({name:'synthetic-probe',description:'S01 synthetic test',type:'project',body:'Synthetic data only.',scope:'project'}, {agent});
    const record = await ctx.tools.get('memory_read').execute({name:'synthetic-probe',scope:'project'}, {agent});
    assert.match(JSON.stringify(record), /Synthetic data only/);
    result.checks.push('synthetic write/read use actual host atomic-write dependency');
    assert.equal(record.status, 'candidate');
    const candidateAssembly = await ctx.systemPrompt.assemble({agent});
    assert.equal(candidateAssembly.sections.find(s=>s.name==='memory-wh:index').text, '');
    result.checks.push('model writes candidate and actual host assembly excludes it');
    // Explicit reviewed fixture, not a real UI/auth integration or automatic user approval.
    const memoryRoot = path.join(probeRoot, 'memory');
    const scopeDir = fs.readdirSync(memoryRoot).find(n => fs.statSync(path.join(memoryRoot,n)).isDirectory() && fs.existsSync(path.join(memoryRoot,n,'synthetic-probe.md')));
    const fixtureFile = path.join(memoryRoot,scopeDir,'synthetic-probe.md');
    const reviewHash = crypto.createHash('sha256').update(JSON.stringify(['synthetic-probe','','S01 synthetic test','project','Synthetic data only.'])).digest('hex');
    fs.writeFileSync(fixtureFile,fs.readFileSync(fixtureFile,'utf8').replace('status: candidate','status: verified\nreviewHash: '+reviewHash));
    const assembly = await ctx.systemPrompt.assemble({agent});
    const rendered = prompt.renderPrompt(assembly);
    result.promptRenderType = typeof rendered;
    const sections = assembly.sections.filter(s=>s.name==='memory-wh:index');
    assert.equal(sections.length,1);
    result.memorySectionBytes = Buffer.byteLength(sections[0].text,'utf8');
    assert.ok(result.memorySectionBytes<=4096);
    assert.match(sections[0].text,/synthetic-probe/);
    result.checks.push('nonempty memory section assembles and renders within 4096 UTF-8 bytes');
    await fiber.dispose();
    assert.ok(!ctx.tools.schemas().some(x=>x.name==='memory_write'));
    result.checks.push('dispose removes registered tools');
    result.status='passed';
  } catch(e) { result.status='failed'; result.error={message:e.message,stack:e.stack}; process.exitCode=1; }
  finally {
    if(ctx) await ctx.fiber.dispose();
    fs.writeFileSync(path.join(evidence,'desktop-host-probe.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({status:result.status,checks:result.checks,error:result.error},null,2));
  }
})();
