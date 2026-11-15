// Seed one synthetic persisted session in the already authorized wh-s05 test home.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const home = path.join(root, '.work/S05/installation-home');
const sessions = path.join(home, 'sessions');
const cwd = path.join(home, 'synthetic-documents/deepseek-harness/default-workspace');
assert.ok(fs.existsSync(path.join(home, 'profiles/wh-s05/package.json')) && fs.existsSync(cwd));
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key];
process.env.DSH_HOME = home;
const deny = () => { throw new Error('NETWORK_BLOCKED_IN_SYNTHETIC_SEED'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) { const mod = require(name); mod.request = deny; mod.get = deny; }
const net = require('node:net'); net.connect = deny; net.createConnection = deny;
require('node:tls').connect = deny; require('node:dgram').createSocket = deny;
const base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const pkg = name => { const dir = base + name, meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main); };
const evidence = path.join(root, 'docs/evidence/S05-rc3-ui-resume/seed.json');
fs.mkdirSync(path.dirname(evidence), { recursive: true });
const result = { status: 'running', scope: 'wh-s05 synthetic home only', modelCalls: 0, networkAttempts: 0 };
(async () => {
 let ctx, owned;
 try {
  const { Context } = pkg('cordis'); ctx = new Context();
  await ctx.plugin(pkg('dsh-session-projection').default, {});
  await ctx.plugin(pkg('dsh-session').default, {});
  await ctx.plugin(pkg('dsh-session-persistence-jsonl'), { root: sessions });
  await ctx.plugin(pkg('dsh-agent').default, {});
  await ctx.plugin(pkg('dsh-system-prompt').default, {});
  await ctx.plugin(pkg('dsh-tools').default, {});
  ctx.provide('llm', { async *stream() { result.modelCalls++; throw new Error('FAKE_MODEL_MUST_NOT_RUN'); } });
  await ctx.plugin(pkg('dsh-agent-loop').default, { agents: [], maxParallelToolCalls: 10 });
  const id = crypto.randomUUID();
  owned = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'wh-local-fake', model: 'synthetic' }, meta: { cwd } });
  const session = owned.agent.session;
  session.append('turn/start', { turn: 1 });
  session.append('step/start', { turn: 1, step: 1 });
  session.append('user/message', { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: 'WH S05 synthetic browser resume seed.' }], source: { kind: 'user' } }, { surfaceOp: 'append' });
  session.append('step/end', { turn: 1, step: 1 });
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await ctx.sessions.flush(session);
  result.sessionId = id; result.events = session.snapshotEvents().length;
  assert.match(JSON.stringify(session.deriveMessages()), /synthetic browser resume seed/);
  await owned.dispose(); owned = undefined;
  result.status = 'passed';
 } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
 finally { if (owned) await owned.dispose().catch(() => {}); if (ctx) await ctx.fiber.dispose().catch(() => {}); fs.writeFileSync(evidence, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
})();
