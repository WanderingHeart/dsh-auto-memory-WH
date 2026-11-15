// Isolated two-process host agent-loop persistence/resume probe. Electron Node only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const installed = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh');
const rc3 = process.argv.includes('--rc3');
const cwdResume = process.argv.includes('--cwd-resume');
assert.ok(!cwdResume || rc3);
const evidence = path.join(root, cwdResume ? 'docs/evidence/S05-rc3-cwd-resume' : rc3 ? 'docs/evidence/S05-rc3-agent-loop-resume' : 'docs/evidence/S05-agent-loop-persistence');
const pointer = path.join(root, cwdResume ? '.work/S05/rc3-cwd-resume-pointer.json' : rc3 ? '.work/S05/rc3-agent-loop-persistence-pointer.json' : '.work/S05/agent-loop-persistence-pointer.json');
const mode = process.argv[2]; assert.ok(['write', 'read'].includes(mode));
fs.mkdirSync(evidence, { recursive: true });
const scratch = mode === 'write' ? fs.mkdtempSync(path.join(root, '.work/S05/agent-loop-persistence-')) : JSON.parse(fs.readFileSync(pointer, 'utf8')).scratch;
assert.ok(path.resolve(scratch).startsWith(path.join(root, '.work/S05') + path.sep));
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key];
process.env.DSH_HOME = path.join(scratch, 'home');
const sessionRoot = path.join(scratch, 'sessions'), memoryDir = path.join(scratch, 'memory'), cwd = path.join(scratch, 'synthetic-project'), nextCwd = path.join(scratch, 'synthetic-next-project');
const pkg = name => { const dir = base + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main); };
const result = { status: 'running', mode, checks: [], installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, networkAttempts: 0, modelCalls: 0 };
const blocked = () => { result.networkAttempts++; throw new Error('NETWORK_BLOCKED_IN_SYNTHETIC_PROBE'); };
globalThis.fetch = blocked;
for (const name of ['node:http', 'node:https']) { const module = require(name); module.request = blocked; module.get = blocked; }
const net = require('node:net'); net.connect = blocked; net.createConnection = blocked;
require('node:tls').connect = blocked; require('node:dgram').createSocket = blocked;
(async () => {
 let ctx, owned;
 try {
  assert.equal(result.installedVersion, rc3 ? '0.1.0-rc.3' : '0.1.0-rc.2');
  const source = fs.readFileSync(path.join(installed, 'lib/index.js'), 'utf8');
  result.bundleSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const rewritten = source.replace(/from "(@deepseek-ai\/[^"/]+)"/g, (_, name) => { const dir = base + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return 'from ' + JSON.stringify(pathToFileURL(dir + '/' + meta.main).href); });
  const bundle = path.join(scratch, 'plugin.mjs'); if (mode === 'write') fs.writeFileSync(bundle, rewritten); else assert.equal(fs.readFileSync(bundle, 'utf8'), rewritten);
  const { Context } = pkg('cordis'); ctx = new Context();
  await ctx.plugin(pkg('dsh-session-projection').default, {});
  await ctx.plugin(pkg('dsh-session').default, {});
  await ctx.plugin(pkg('dsh-session-persistence-jsonl'), { root: sessionRoot });
  await ctx.plugin(pkg('dsh-agent').default, {});
  await ctx.plugin(pkg('dsh-system-prompt').default, {});
  await ctx.plugin(pkg('dsh-tools').default, {});
  if (cwdResume) {
   fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(nextCwd, { recursive: true });
   ctx.provide('fs', { resolve: async (p, options) => path.resolve(options?.cwd ?? scratch, p), stat: async p => fs.existsSync(p) ? { type: fs.statSync(p).isDirectory() ? 'directory' : 'file' } : undefined, processPath: p => p });
   await ctx.plugin(pkg('dsh-working-directory').default, { defaultDirectory: cwd });
  }
  ctx.provide('llm', { async *stream(options) { result.modelCalls++; assert.equal(mode, 'write'); assert.equal(options.purpose, 'compaction'); assert.equal(options.provider, 'wh-local-fake'); yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic loop durable summary.' } }; yield { type: 'finish', reason: { kind: 'stop' } }; } });
  if (mode === 'write') {
   ctx.provide('tokenMeter', { measure: session => { const nodes = session.surface.nodes.map(seq => ({ seq, tokens: 10000, heuristicTokens: 10000 })); return { nodes, totalTokens: nodes.length * 10000 }; }, estimateMessage: () => 1 });
   await ctx.plugin(pkg('dsh-compaction-basic').default, { auto: false, summarizationProvider: 'wh-local-fake', summarizationModel: 'synthetic', maxTokens: 128 });
  }
  await ctx.plugin(pkg('dsh-agent-loop').default, { agents: [], maxParallelToolCalls: 10 });
  await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href });
  await ctx.loader.create({ id: 'wh-loop', name: pathToFileURL(bundle).href, config: { memoryDir, maxBytes: 4096, enableUserScope: true, autoSummarize: false, staleAfterDays: 0 } });
  await ctx.loader.await();
  if (mode === 'write') {
   owned = await ctx.agents.create({ sessionId: 'loop-durable', agentOptions: { provider: 'wh-local-fake', model: 'synthetic' }, meta: { cwd } });
   const { agent } = owned;
   await ctx.tools.get('memory_write').execute({ name: 'loop-reviewed', description: 'Synthetic loop memory', body: 'Synthetic loop body.', type: 'project', scope: 'project' }, { agent });
   const file = fs.readdirSync(memoryDir, { recursive: true, withFileTypes: true }).find(item => item.isFile() && item.name === 'loop-reviewed.md'); assert.ok(file);
   const target = path.join(file.parentPath, file.name), raw = fs.readFileSync(target, 'utf8');
   const reviewHash = crypto.createHash('sha256').update(JSON.stringify(['loop-reviewed', '', 'Synthetic loop memory', 'project', 'Synthetic loop body.'])).digest('hex');
   fs.writeFileSync(target, raw.replace('status: candidate', 'status: verified\nreviewHash: ' + reviewHash));
   for (let turn = 1; turn <= 2; turn++) { agent.session.append('turn/start', { turn }); agent.session.append('step/start', { turn, step: 1 }); agent.session.append('user/message', { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: 'Synthetic auto-routed turn ' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' }); agent.session.append('step/end', { turn, step: 1 }); agent.session.append('turn/end', { turn, reason: { kind: 'completed' } }); }
   const section = (await ctx.systemPrompt.assemble({ agent })).sections.find(item => item.name === 'memory-wh:index')?.text ?? '';
   assert.match(section, /loop-reviewed/);
   result.checks.push('real agent-loop creates owned session and WH injects reviewed synthetic memory');
   if (cwdResume) {
    assert.equal(await ctx.workingDirectory.set(agent, nextCwd), nextCwd);
    await ctx.tools.get('memory_write').execute({ name: 'next-reviewed', description: 'Synthetic next memory', body: 'Synthetic next body.', type: 'project', scope: 'project' }, { agent });
    const next = fs.readdirSync(memoryDir, { recursive: true, withFileTypes: true }).find(item => item.isFile() && item.name === 'next-reviewed.md'); assert.ok(next);
    const nextFile = path.join(next.parentPath, next.name), nextRaw = fs.readFileSync(nextFile, 'utf8');
    const nextHash = crypto.createHash('sha256').update(JSON.stringify(['next-reviewed', '', 'Synthetic next memory', 'project', 'Synthetic next body.'])).digest('hex');
    fs.writeFileSync(nextFile, nextRaw.replace('status: candidate', 'status: verified\nreviewHash: ' + nextHash));
    const moved = (await ctx.systemPrompt.assemble({ agent })).sections.find(item => item.name === 'memory-wh:index')?.text ?? '';
    assert.match(moved, /next-reviewed/); assert.doesNotMatch(moved, /loop-reviewed/);
    result.checks.push('working-directory set switches WH injection from old to new synthetic project');
   }
   assert.ok(await ctx.compaction.compactNow(agent, new AbortController().signal));
   assert.match(JSON.stringify(agent.session.deriveMessages()), /Synthetic loop durable summary/);
   result.checks.push('real compaction engine replaces synthetic history on agent-loop owned session');
   await ctx.sessions.flush(agent.session);
   result.eventCount = agent.session.snapshotEvents().length;
   await owned.dispose(); owned = undefined;
   fs.writeFileSync(pointer, JSON.stringify({ scratch }));
   result.checks.push('real session/event routing persists event without manual backend append');
  } else {
   owned = await ctx.agents.resume({ resumeSessionId: 'loop-durable', agentOptions: { provider: 'wh-local-fake', model: 'synthetic' } });
   const { agent } = owned;
   assert.equal(agent.session.header.cwd, cwd);
   if (cwdResume) assert.equal(ctx.workingDirectory.get(agent.session), nextCwd);
   assert.match(JSON.stringify(agent.session.deriveMessages()), /Synthetic loop durable summary/);
   assert.doesNotMatch(JSON.stringify(agent.session.deriveMessages()), /Synthetic auto-routed turn 1/);
   for (const type of ['compaction/start', 'compaction/summary', 'compaction/end']) assert.ok(agent.session.snapshotEvents().some(event => event.type === type), type);
   const section = (await ctx.systemPrompt.assemble({ agent })).sections.find(item => item.name === 'memory-wh:index')?.text ?? '';
   assert.match(section, cwdResume ? /next-reviewed/ : /loop-reviewed/);
   if (cwdResume) assert.doesNotMatch(section, /loop-reviewed/);
   result.eventCount = agent.session.snapshotEvents().length;
   result.checks.push('second process resumes via real agent-loop and reconstructs routed session event');
   result.checks.push('installed WH injects reviewed current-source record after real agent-loop resume');
   await owned.dispose(); owned = undefined;
   await ctx.fiber.dispose(); ctx = undefined;
   const audits = fs.readFileSync(path.join(memoryDir, 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
   assert.equal(audits.length, cwdResume ? 3 : 2);
   assert.ok(audits.every(item => item.bytes > 0));
   if (cwdResume) { assert.deepEqual(audits.map(item => item.injected), [['loop-reviewed'], ['next-reviewed'], ['next-reviewed']]); }
   else assert.ok(audits.every(item => item.injected.includes('loop-reviewed')));
   result.auditCount = audits.length;
   result.checks.push(cwdResume ? 'WH audits show old project once and current project before and after resume' : 'WH write/resume render audits both identify reviewed synthetic record');
  }
  assert.equal(result.modelCalls, mode === 'write' ? 1 : 0); assert.equal(result.networkAttempts, 0);
  result.status = 'passed';
 } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
 finally { if (owned) await owned.dispose().catch(() => {}); if (ctx) await ctx.fiber.dispose().catch(() => {}); fs.writeFileSync(path.join(evidence, mode + '.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
})();
