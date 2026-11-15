// Two-process isolated JSONL persistence probe. Run write then read with Electron Node.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const installed = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh');
const evidence = path.join(root, 'docs/evidence/S05-durable-compact'), pointer = path.join(root, '.work/S05/durable-compact-pointer.json');
fs.mkdirSync(evidence, { recursive: true });
const mode = process.argv[2]; assert.ok(mode === 'write' || mode === 'read');
const scratch = mode === 'write' ? fs.mkdtempSync(path.join(root, '.work/S05/durable-compact-')) : JSON.parse(fs.readFileSync(pointer, 'utf8')).scratch;
assert.ok(path.resolve(scratch).startsWith(path.join(root, '.work/S05') + path.sep));
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key];
process.env.DSH_HOME = path.join(scratch, 'home');
const sessionRoot = path.join(scratch, 'sessions'), memoryDir = path.join(scratch, 'memory');
const pkg = name => { const dir = base + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main); };
const result = { status: 'running', mode, checks: [], installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, fakeModelCalls: 0, networkAttempts: 0, limitation: 'Actual packaged JSONL backend and basic compaction with installed WH across two Electron Node processes. Session write handle is connected manually to synthetic agent; no live agent-loop persistence routing or real model.' };
const blocked = () => { result.networkAttempts++; throw new Error('NETWORK_BLOCKED_IN_SYNTHETIC_PROBE'); };
globalThis.fetch = blocked;
for (const name of ['node:http', 'node:https']) { const module = require(name); module.request = blocked; module.get = blocked; }
const net = require('node:net'); net.connect = blocked; net.createConnection = blocked;
require('node:tls').connect = blocked; require('node:dgram').createSocket = blocked;
(async () => {
 let ctx, handle;
 try {
  assert.equal(result.installedVersion, '0.1.0-rc.2');
  const source = fs.readFileSync(path.join(installed, 'lib/index.js'), 'utf8');
  result.installedBundleSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const rewritten = source.replace(/from "(@deepseek-ai\/[^"/]+)"/g, (_, name) => { const dir = base + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return 'from ' + JSON.stringify(pathToFileURL(dir + '/' + meta.main).href); });
  const bundle = path.join(scratch, 'plugin.mjs'); if (mode === 'write') fs.writeFileSync(bundle, rewritten); else assert.equal(fs.readFileSync(bundle, 'utf8'), rewritten);
  const { Context } = pkg('cordis'); ctx = new Context();
  await ctx.plugin(pkg('dsh-session').default, {});
  await ctx.plugin(pkg('dsh-session-persistence-jsonl'), { root: sessionRoot });
  await ctx.plugin(pkg('dsh-system-prompt').default, {});
  await ctx.plugin(pkg('dsh-tools').default, {});
  if (mode === 'write') {
   const meter = { measure: session => { const nodes = session.surface.nodes.map(seq => ({ seq, tokens: 10000, heuristicTokens: 10000 })); return { nodes, totalTokens: nodes.length * 10000 }; }, estimateMessage: () => 1 };
   const fakeLlm = { async *stream(options) { result.fakeModelCalls++; assert.equal(options.purpose, 'compaction'); assert.equal(options.provider, 'wh-local-fake'); assert.equal(options.model, 'synthetic'); yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic durable summary.' } }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
   ctx.provide('tokenMeter', meter); ctx.provide('llm', fakeLlm);
   await ctx.plugin(pkg('dsh-compaction-basic').default, { auto: false, summarizationProvider: 'wh-local-fake', summarizationModel: 'synthetic', maxTokens: 128 });
  }
  await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href });
  await ctx.loader.create({ id: 'wh-durable', name: pathToFileURL(bundle).href, config: { memoryDir, maxBytes: 4096, enableUserScope: true, autoSummarize: false, staleAfterDays: 0 } });
  await ctx.loader.await();
  const cwd = path.join(scratch, 'synthetic-project');
  let session;
  if (mode === 'write') {
   session = ctx.sessions.create('durable-session', { meta: { cwd } });
  } else {
   handle = await ctx.sessionPersistence.open('durable-session', 'read');
   const stored = await handle.read();
   assert.ok(stored.events.length > 0); assert.equal(handle.header.cwd, cwd);
   session = ctx.sessions.create('durable-session', { seed: stored.events, meta: { cwd } });
   result.storedEventCount = stored.events.length;
   result.checks.push('new process opens real JSONL session handle and seeds a new SessionStore object');
  }
  const agent = { session, options: { provider: 'wh-local-fake', model: 'synthetic', subagentDepth: 0 }, async runMaintenance(work) { return work(new AbortController().signal); } };
  const prompt = async () => (await ctx.systemPrompt.assemble({ agent })).sections.find(item => item.name === 'memory-wh:index')?.text ?? '';
  if (mode === 'write') {
   await ctx.tools.get('memory_write').execute({ name: 'durable-reviewed', description: 'Synthetic durable memory', body: 'Synthetic memory body.', type: 'project', scope: 'project' }, { agent });
   const file = fs.readdirSync(memoryDir, { recursive: true, withFileTypes: true }).find(item => item.isFile() && item.name === 'durable-reviewed.md'); assert.ok(file);
   const target = path.join(file.parentPath, file.name), raw = fs.readFileSync(target, 'utf8'); assert.match(raw, /status: candidate/);
   const reviewHash = crypto.createHash('sha256').update(JSON.stringify(['durable-reviewed', '', 'Synthetic durable memory', 'project', 'Synthetic memory body.'])).digest('hex');
   fs.writeFileSync(target, raw.replace('status: candidate', 'status: verified\nreviewHash: ' + reviewHash));
   assert.match(await prompt(), /durable-reviewed/);
   for (let turn = 1; turn <= 2; turn++) { session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 }); session.append('user/message', { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: 'Synthetic durable turn ' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' }); session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } }); }
   const compacted = await ctx.compaction.compactNow(agent, new AbortController().signal);
   assert.ok(compacted); assert.equal(result.fakeModelCalls, 1);
   assert.match(await prompt(), /durable-reviewed/);
   assert.match(JSON.stringify(session.deriveMessages()), /Synthetic durable summary/);
   result.checks.push('actual basic engine compacts synthetic history and WH injects before/after');
   handle = await ctx.sessionPersistence.create(session.header);
   await handle.append(session.snapshotEvents()); await handle.flush(); await handle.close(); handle = undefined;
   result.storedEventCount = session.seq;
   result.checks.push('real JSONL write handle durably appends and flushes the compacted event log');
   fs.writeFileSync(pointer, JSON.stringify({ scratch }));
  } else {
   const events = session.snapshotEvents();
   for (const type of ['compaction/start', 'compaction/summary', 'compaction/end']) assert.ok(events.some(event => event.type === type), type);
   const messages = JSON.stringify(session.deriveMessages()); assert.match(messages, /Synthetic durable summary/); assert.doesNotMatch(messages, /Synthetic durable turn 1/);
   result.checks.push('reloaded real session preserves compaction markers and replacement surface');
   assert.match(await prompt(), /durable-reviewed/);
   result.checks.push('installed WH reassembles reviewed current-source memory after cross-process session reload');
  }
  await ctx.fiber.dispose(); ctx = undefined;
  if (mode === 'read') {
   const audits = fs.readFileSync(path.join(memoryDir, 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
   assert.equal(audits.length, 3); assert.ok(audits.every(item => item.bytes > 0 && item.injected.includes('durable-reviewed')));
   result.auditCount = audits.length;
   result.checks.push('WH audit has two write-process attempts and one read-process attempt');
  }
  assert.equal(result.networkAttempts, 0); result.status = 'passed';
 } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
 finally { if (handle) await handle.close(); if (ctx) await ctx.fiber.dispose(); fs.writeFileSync(path.join(evidence, mode + '.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
})();
