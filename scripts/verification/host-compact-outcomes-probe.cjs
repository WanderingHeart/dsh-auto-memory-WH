// Actual /compact adapter and basic engine with local fake services; success/failure/cancel.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const installed = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh');
const evidence = path.join(root, 'docs/evidence/S05-compact-outcomes'); fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.work/S05/compact-outcomes-'));
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key];
process.env.DSH_HOME = path.join(scratch, 'home');
const pkg = name => { const dir = base + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main); };
const result = { status: 'running', checks: [], installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, fakeModelCalls: { success: 0, failure: 0, cancelled: 0 }, networkAttempts: 0, limitation: 'Actual packaged /compact adapter and basic engine, installed WH, synthetic sessions and local fake LLM/meter/maintenance. No real model, durable backend, or real agent loop.' };
const blocked = () => { result.networkAttempts++; throw new Error('NETWORK_BLOCKED_IN_SYNTHETIC_PROBE'); };
globalThis.fetch = blocked;
for (const name of ['node:http', 'node:https']) { const module = require(name); module.request = blocked; module.get = blocked; }
const net = require('node:net'); net.connect = blocked; net.createConnection = blocked;
require('node:tls').connect = blocked; require('node:dgram').createSocket = blocked;
(async () => {
 let ctx;
 try {
  assert.equal(result.installedVersion, '0.1.0-rc.2');
  const source = fs.readFileSync(path.join(installed, 'lib/index.js'), 'utf8');
  result.installedBundleSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const rewritten = source.replace(/from "(@deepseek-ai\/[^"/]+)"/g, (_, name) => { const dir = base + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return 'from ' + JSON.stringify(pathToFileURL(dir + '/' + meta.main).href); });
  const bundle = path.join(scratch, 'plugin.mjs'); fs.writeFileSync(bundle, rewritten);
  const { Context } = pkg('cordis'); ctx = new Context();
  await ctx.plugin(pkg('dsh-session').default, {});
  await ctx.plugin(pkg('dsh-system-prompt').default, {});
  await ctx.plugin(pkg('dsh-tools').default, {});
  const meter = { measure: session => { const nodes = session.surface.nodes.map(seq => ({ seq, tokens: 10000, heuristicTokens: 10000 })); return { nodes, totalTokens: nodes.length * 10000 }; }, estimateMessage: () => 1 };
  let cancelEntered, releaseCancel;
  const cancelGate = new Promise(resolve => { releaseCancel = resolve; });
  const cancelStarted = new Promise(resolve => { cancelEntered = resolve; });
  const fakeLlm = { async *stream(options) {
   assert.equal(options.provider, 'wh-local-fake'); assert.equal(options.model, 'synthetic'); assert.equal(options.purpose, 'compaction');
   const mode = options.sessionId.replace('compact-', ''); assert.ok(mode in result.fakeModelCalls);
   result.fakeModelCalls[mode]++;
   if (mode === 'failure') throw new Error('SYNTHETIC_SUMMARY_FAILURE');
   if (mode === 'cancelled') { cancelEntered(); await cancelGate; options.signal.throwIfAborted(); }
   yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic compacted summary.' } };
   yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  ctx.provide('tokenMeter', meter); ctx.provide('llm', fakeLlm);
  let registered;
  ctx.provide('commands', { register: command => { registered = command; return () => { registered = undefined; }; } });
  let flushes = 0; ctx.on('session/flush', () => { flushes++; });
  await ctx.plugin(pkg('dsh-compaction-basic').default, { auto: false, summarizationProvider: 'wh-local-fake', summarizationModel: 'synthetic', maxTokens: 128 });
  await ctx.plugin(pkg('dsh-command-compact'), {});
  assert.equal(registered?.name, 'compact');
  await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href });
  const memoryDir = path.join(scratch, 'memory');
  await ctx.loader.create({ id: 'wh-compact-outcomes', name: pathToFileURL(bundle).href, config: { memoryDir, maxBytes: 4096, enableUserScope: true, autoSummarize: false, staleAfterDays: 0 } });
  await ctx.loader.await();
  const cwd = path.join(scratch, 'synthetic-project');
  const createAgent = mode => {
   const session = ctx.sessions.create('compact-' + mode, { meta: { cwd } });
   const agent = { session, options: { provider: 'wh-local-fake', model: 'synthetic', subagentDepth: 0 }, async runMaintenance(work) { return work(new AbortController().signal); } };
   for (let turn = 1; turn <= 2; turn++) {
    session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 });
    session.append('user/message', { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: 'Synthetic ' + mode + ' turn ' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' });
    session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } });
   }
   return agent;
  };
  const success = createAgent('success'), failure = createAgent('failure'), cancelled = createAgent('cancelled');
  await ctx.tools.get('memory_write').execute({ name: 'compact-outcome-record', description: 'Synthetic outcome record', body: 'Synthetic safe body.', type: 'project', scope: 'project' }, { agent: success });
  const file = fs.readdirSync(memoryDir, { recursive: true, withFileTypes: true }).find(item => item.isFile() && item.name === 'compact-outcome-record.md'); assert.ok(file);
  const target = path.join(file.parentPath, file.name), raw = fs.readFileSync(target, 'utf8'); assert.match(raw, /status: candidate/);
  const reviewHash = crypto.createHash('sha256').update(JSON.stringify(['compact-outcome-record', '', 'Synthetic outcome record', 'project', 'Synthetic safe body.'])).digest('hex');
  fs.writeFileSync(target, raw.replace('status: candidate', 'status: verified\nreviewHash: ' + reviewHash));
  const prompt = async agent => (await ctx.systemPrompt.assemble({ agent })).sections.find(item => item.name === 'memory-wh:index')?.text ?? '';
  const expected = await prompt(success); assert.match(expected, /compact-outcome-record/);
  const invoke = (agent, signal, rawInput = '') => registered.handler({ agent, signal, rawInput, commandId: 'synthetic-command' });
  const invalid = await invoke(success, new AbortController().signal, 'unexpected');
  assert.equal(invalid.kind, 'error'); assert.match(invalid.text, /Usage: \/compact/);
  assert.deepEqual(result.fakeModelCalls, { success: 0, failure: 0, cancelled: 0 });
  result.checks.push('actual command adapter rejects arguments before any model call');
  const beforeSuccess = success.session.surface.nodes.slice();
  const successResult = await invoke(success, new AbortController().signal);
  assert.equal(successResult.kind, 'success'); assert.equal(result.fakeModelCalls.success, 1);
  assert.ok(success.session.snapshotEvents().some(event => event.type === 'compaction/summary'));
  assert.notDeepEqual(success.session.surface.nodes, beforeSuccess);
  const successMessages = JSON.stringify(success.session.deriveMessages());
  assert.match(successMessages, /Synthetic compacted summary/); assert.doesNotMatch(successMessages, /Synthetic success turn 1/);
  assert.equal(await prompt(success), expected);
  result.checks.push('actual /compact adapter commits one local-fake summary while WH injection stays current');
  const beforeFailure = failure.session.surface.nodes.slice();
  assert.equal(await prompt(failure), expected);
  const failureResult = await invoke(failure, new AbortController().signal);
  assert.equal(failureResult.kind, 'error'); assert.equal(result.fakeModelCalls.failure, 1);
  assert.deepEqual(failure.session.surface.nodes, beforeFailure);
  assert.ok(failure.session.snapshotEvents().some(event => event.type === 'compaction/end' && event.data.error));
  assert.equal(await prompt(failure), expected);
  result.checks.push('fake summary failure closes compaction without replacing history or changing WH injection');
  const beforeCancel = cancelled.session.surface.nodes.slice();
  assert.equal(await prompt(cancelled), expected);
  const controller = new AbortController();
  const pending = invoke(cancelled, controller.signal);
  await cancelStarted;
  controller.abort(new Error('SYNTHETIC_CANCEL'));
  releaseCancel();
  const cancelledResult = await pending;
  assert.equal(cancelledResult.kind, 'error'); assert.match(cancelledResult.text, /cancelled/i);
  assert.equal(result.fakeModelCalls.cancelled, 1);
  assert.deepEqual(cancelled.session.surface.nodes, beforeCancel);
  assert.ok(cancelled.session.snapshotEvents().some(event => event.type === 'compaction/end' && event.data.error));
  assert.equal(await prompt(cancelled), expected);
  result.checks.push('mid-summary cancellation closes attempt without replacing history or changing WH injection');
  await ctx.fiber.dispose(); ctx = undefined;
  const audits = fs.readFileSync(path.join(memoryDir, 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(audits.length, 6);
  assert.ok(audits.every(item => item.kind === 'render_attempt' && item.pluginVersion === '0.1.0-rc.2' && item.bytes === Buffer.byteLength(expected) && item.injected.includes('compact-outcome-record')));
  assert.equal(result.networkAttempts, 0);
  result.auditCount = audits.length; result.flushes = flushes;
  result.checks.push('WH audit records six matching pre/post attempts across all three outcomes; no network exit was used');
  result.status = 'passed';
 } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
 finally { if (ctx) await ctx.fiber.dispose(); fs.writeFileSync(path.join(evidence, 'probe.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
})();
