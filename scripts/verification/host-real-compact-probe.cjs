// Actual DSH basic compaction transaction with fake local LLM/meter and installed WH.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const installed = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh');
const evidence = path.join(root, 'docs/evidence/S05-real-compact'); fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.work/S05/real-compact-'));
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key];
process.env.DSH_HOME = path.join(scratch, 'home');
const pkg = name => { const dir = base + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main); };
const result = { status: 'running', checks: [], installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, networkAttempts: 0, fakeModelCalls: 0, limitation: 'Actual packaged basic compaction engine and installed WH with synthetic session, local fake LLM/meter, synthetic maintenance agent, no durable session backend or real model.' };
const blocked = () => { result.networkAttempts++; throw new Error('NETWORK_BLOCKED_IN_SYNTHETIC_PROBE'); };
globalThis.fetch = blocked;
for (const name of ['node:http', 'node:https']) { const module = require(name); module.request = blocked; module.get = blocked; }
const net = require('node:net'); net.connect = blocked; net.createConnection = blocked;
require('node:tls').connect = blocked;
require('node:dgram').createSocket = blocked;
(async () => {
 let ctx;
 try {
  assert.equal(result.installedVersion, '0.1.0-rc.2');
  const original = fs.readFileSync(path.join(installed, 'lib/index.js'), 'utf8');
  result.installedBundleSha256 = crypto.createHash('sha256').update(original).digest('hex');
  const rewritten = original.replace(/from "(@deepseek-ai\/[^"/]+)"/g, (_, name) => { const dir = base + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return 'from ' + JSON.stringify(pathToFileURL(dir + '/' + meta.main).href); });
  const bundle = path.join(scratch, 'plugin.mjs'); fs.writeFileSync(bundle, rewritten);
  const { Context } = pkg('cordis'); ctx = new Context();
  await ctx.plugin(pkg('dsh-session').default, {});
  await ctx.plugin(pkg('dsh-system-prompt').default, {});
  await ctx.plugin(pkg('dsh-tools').default, {});
  let flushes = 0;
  ctx.on('session/flush', () => { flushes++; });
  const meter = {
   measure: session => { const nodes = session.surface.nodes.map(seq => ({ seq, tokens: 10000, heuristicTokens: 10000 })); return { nodes, totalTokens: nodes.length * 10000 }; },
   estimateMessage: () => 1,
  };
  const fakeLlm = { async *stream(options) {
   result.fakeModelCalls++;
   assert.equal(options.provider, 'wh-local-fake'); assert.equal(options.model, 'synthetic');
   assert.equal(options.purpose, 'compaction'); assert.equal(options.sessionId, 'compact-session');
   assert.ok(options.messages.every(message => JSON.stringify(message).includes('Synthetic') || JSON.stringify(message).includes('summar')));
   yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic compacted summary.' } };
   yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  ctx.provide('tokenMeter', meter); ctx.provide('llm', fakeLlm);
  assert.equal(ctx.llm, fakeLlm); assert.equal(ctx.tokenMeter, meter);
  await ctx.plugin(pkg('dsh-compaction-basic').default, { auto: false, summarizationProvider: 'wh-local-fake', summarizationModel: 'synthetic', maxTokens: 128 });
  await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href });
  const memoryDir = path.join(scratch, 'memory');
  await ctx.loader.create({ id: 'wh-real-compact', name: pathToFileURL(bundle).href, config: { memoryDir, maxBytes: 4096, enableUserScope: true, autoSummarize: false, staleAfterDays: 0 } });
  await ctx.loader.await();
  const session = ctx.sessions.create('compact-session', { meta: { cwd: path.join(scratch, 'synthetic-project') } });
  const agent = { session, options: { provider: 'wh-local-fake', model: 'synthetic', subagentDepth: 0 }, async runMaintenance(work) { return work(new AbortController().signal); } };
  await ctx.tools.get('memory_write').execute({ name: 'compact-review', description: 'Synthetic reviewed record', body: 'Synthetic memory body.', type: 'project', scope: 'project' }, { agent });
  const record = fs.readdirSync(memoryDir, { recursive: true, withFileTypes: true }).find(item => item.isFile() && item.name === 'compact-review.md'); assert.ok(record);
  const recordPath = path.join(record.parentPath, record.name); const raw = fs.readFileSync(recordPath, 'utf8'); assert.match(raw, /status: candidate/);
  const reviewHash = crypto.createHash('sha256').update(JSON.stringify(['compact-review', '', 'Synthetic reviewed record', 'project', 'Synthetic memory body.'])).digest('hex');
  fs.writeFileSync(recordPath, raw.replace('status: candidate', 'status: verified\nreviewHash: ' + reviewHash));
  const prompt = async () => (await ctx.systemPrompt.assemble({ agent })).sections.find(item => item.name === 'memory-wh:index')?.text ?? '';
  const before = await prompt(); assert.match(before, /compact-review/); assert.ok(Buffer.byteLength(before) <= 4096);
  result.checks.push('installed WH injects one reviewed synthetic record before compaction');
  for (let turn = 1; turn <= 2; turn++) {
   session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
   session.append('user/message', { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: 'Synthetic turn ' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' });
   session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } });
  }
  const compacted = await ctx.compaction.compactNow(agent, new AbortController().signal);
  assert.ok(compacted); assert.equal(result.fakeModelCalls, 1); assert.equal(result.networkAttempts, 0);
  const eventTypes = session.snapshotEvents().map(event => event.type);
  for (const type of ['compaction/start', 'compaction/summary', 'compaction/end']) assert.ok(eventTypes.includes(type), type);
  const derived = JSON.stringify(session.deriveMessages());
  assert.match(derived, /Synthetic compacted summary/); assert.doesNotMatch(derived, /Synthetic turn 1/); assert.match(derived, /Synthetic turn 2/);
  result.compaction = { shadowedCount: compacted.shadowedSeqs.length, flushes, eventTypes: eventTypes.filter(type => type.startsWith('compaction/')) };
  result.checks.push('actual basic compaction commits summary and surface replacement through one local fake model call');
  const after = await prompt(); assert.match(after, /compact-review/); assert.equal(after, before);
  result.checks.push('WH reassembles the same current-source memory after actual compaction');
  const edited = fs.readFileSync(recordPath, 'utf8').replace('Synthetic memory body.', 'Externally edited synthetic body.');
  fs.writeFileSync(recordPath, edited);
  assert.equal(await prompt(), before);
  result.checks.push('post-compaction external semantic edit keeps the record injected (no review gate)');
  await ctx.fiber.dispose(); ctx = undefined;
  const audits = fs.readFileSync(path.join(memoryDir, 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(audits.length, 3);
  assert.ok(audits.slice(0, 2).every(entry => entry.kind === 'render_attempt' && entry.pluginVersion === '0.1.0-rc.2' && entry.bytes === Buffer.byteLength(before) && entry.injected.includes('compact-review')));
  assert.equal(audits[2].bytes, Buffer.byteLength(before));
  assert.ok(audits[2].injected.includes('compact-review'));
  result.checks.push('WH persists three matching injection attempts after shutdown drain');
  assert.equal(result.networkAttempts, 0);
  result.status = 'passed';
 } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
 finally { if (ctx) await ctx.fiber.dispose(); fs.writeFileSync(path.join(evidence, 'probe.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
})();
