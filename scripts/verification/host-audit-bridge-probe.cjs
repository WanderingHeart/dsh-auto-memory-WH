// Installed WH through packaged DSH Web, authentication and prompt services.
// All state lives in a fresh .work/S05 directory; only synthetic records are used.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const modules = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const installed = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh');
const rc6 = process.argv.includes('--rc6');
const rc8 = process.argv.includes('--rc8');
const rc9 = process.argv.includes('--rc9');
const rc10 = process.argv.includes('--rc10');
const rc11 = process.argv.includes('--rc11');
const versionIndex = process.argv.indexOf('--installed-version');
const explicitVersion = versionIndex >= 0 ? process.argv[versionIndex + 1] : null;
if (explicitVersion && !/^\d+\.\d+\.\d+(?:-rc\.[0-9]+)?$/.test(explicitVersion)) throw new Error('--installed-version must look like 0.1.0 or 0.1.0-rc.N');
if ([rc6, rc8, rc9, rc10, rc11].filter(Boolean).length > 1) throw new Error('Choose only one installed version');
const nativeAudit = process.argv.includes('--native-audit');
if (nativeAudit && !rc8) throw new Error('Native audit seed requires rc.8');
const derivedStage = explicitVersion ? (explicitVersion.match(/rc\.([0-9]+)/) ? `S05-rc${explicitVersion.match(/rc\.([0-9]+)/)[1]}` : `S05-${explicitVersion}`) : null;
const evidence = path.join(root, nativeAudit ? 'docs/evidence/S05-native-audit-readiness' : derivedStage ? `docs/evidence/${derivedStage}-audit-bridge` : rc11 ? 'docs/evidence/S05-rc11-audit-bridge' : rc10 ? 'docs/evidence/S05-rc10-audit-bridge' : rc9 ? 'docs/evidence/S05-rc9-audit-bridge' : rc8 ? 'docs/evidence/S05-rc8-audit-bridge' : rc6 ? 'docs/evidence/S05-rc6-audit-bridge' : 'docs/evidence/S05-rc3-audit-bridge');
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.work/S05/audit-bridge-'));
const profileSeed = process.argv.includes('--profile-seed');
const lifecycle = process.argv.includes('--lifecycle');
const policyMatrix = process.argv.includes('--policy-matrix');
if (policyMatrix && (!(explicitVersion || rc8 || rc9 || rc10 || rc11) || profileSeed)) throw new Error('Policy matrix is only for a fresh synthetic root on a supported candidate');
if (nativeAudit && (profileSeed || policyMatrix)) throw new Error('Native audit seed cannot be combined with other seed modes');
const nativeHome = path.join(root, '.work/S05/native-real-user-home');
const nativePointer = nativeAudit ? JSON.parse(fs.readFileSync(path.join(root, '.work/S05/native-audit-session-pointer-r72.json'), 'utf8')) : null;
if (nativeAudit) {
 assert.ok(nativePointer.home === nativeHome && nativePointer.cwd.startsWith(nativeHome + path.sep));
 assert.ok(fs.existsSync(path.join(root, '.work/S05/native-audit-memory-baseline-r72/.wh-format.json')));
 assert.ok(!fs.existsSync(path.join(nativeHome, 'memory-wh/audit.jsonl')), 'Native audit already exists');
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(nativeHome, '.credentials.yaml'))).digest('hex').toUpperCase(), '9FF947C05D4EDAD0728B1DD929C8C9D02DBB5167382AF51DD20189B2B1708296');
}
for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET|PASSWORD|^DSH_/i.test(key)) delete process.env[key];
process.env.DSH_HOME = path.join(scratch, 'home');
const profileHome = path.join(root, '.work/S05/installation-home');
const memoryDir = nativeAudit ? path.join(nativeHome, 'memory-wh') : profileSeed ? path.join(profileHome, 'memory-wh') : path.join(scratch, 'memory');
const cwd = nativeAudit ? nativePointer.cwd : profileSeed ? path.join(profileHome, 'synthetic-documents/deepseek-harness/default-workspace') : path.join(scratch, 'synthetic-project');
fs.mkdirSync(cwd, { recursive: true });
const pkg = name => { const dir = modules + '@deepseek-ai/' + name; const meta = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); return require(dir + '/' + meta.main); };
const result = { status: 'running', installedVersion: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, checks: [], scope: nativeAudit ? 'Native isolated synthetic memory and session; local HTTP only, no model request' : profileSeed ? 'Existing wh-s05 synthetic profile memory; local HTTP only, no model request' : 'Fresh isolated synthetic home, local HTTP only, no model request' };
(async () => {
 let ctx;
 try {
  assert.equal(result.installedVersion, explicitVersion ?? (rc11 ? '0.1.0-rc.11' : rc10 ? '0.1.0-rc.10' : rc9 ? '0.1.0-rc.9' : rc8 ? '0.1.0-rc.8' : rc6 ? '0.1.0-rc.6' : '0.1.0-rc.3'));
  const source = fs.readFileSync(path.join(installed, 'lib/index.js'), 'utf8');
  result.bundleSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const rewritten = source.replace(/from "(@deepseek-ai\/[^"/]+|yaml)"/g, (_, name) => {
   const hostDir = modules + name, localDir = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules', name);
   const dir = fs.existsSync(hostDir + '/package.json') ? hostDir : localDir;
   const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
   const entry = dir === hostDir ? meta.main : (meta.exports?.['.']?.import ?? meta.module ?? meta.main);
   return 'from ' + JSON.stringify(pathToFileURL(path.join(dir, entry)).href);
  });
  const bundle = path.join(scratch, 'plugin.mjs'); fs.writeFileSync(bundle, rewritten);
  const { Context } = pkg('cordis'), { CredentialProvider } = pkg('dsh-credentials');
  class MemoryCredentials extends CredentialProvider {
   records = new Map();
   async modifyRecord(key, fn) { const change = await fn(this.records.get(key)); if (change) this.records.set(key, change); return this.records.get(key); }
  }
  ctx = new Context();
  await ctx.plugin(MemoryCredentials, {});
  await ctx.plugin(pkg('dsh-host-webserver').default, { host: '127.0.0.1', port: 0 });
  await ctx.plugin(pkg('dsh-client-connection'), {});
  await ctx.plugin(pkg('dsh-system-prompt').default, {});
  await ctx.plugin(pkg('dsh-tools').default, {});
  await ctx.plugin(pkg('dsh-tool-executor-native'), {});
  await ctx.plugin(pkg('cordis-plugin-loader').default, { baseUrl: pathToFileURL(scratch + '/').href });
  await ctx.loader.create({ id: 'wh-audit', name: pathToFileURL(bundle).href, config: { memoryDir, maxBytes: 4096, enableUserScope: true, autoSummarize: false } });
  await ctx.loader.await();
  ctx.webServer.register({ kind: 'exact', path: '/', handler: (req, res) => { if (ctx.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('synthetic audit probe'); } } });
  const origin = ctx.webServer.getOrigin();
  const login = await fetch(ctx.connection.authenticatedUrl(origin + '/'), { redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const route = origin + '/api/auto-memory-wh/';
  const call = async (name, data, method = 'GET', withCookie = true) => fetch(route + name + (method === 'GET' ? '?' + new URLSearchParams(data) : ''), { method, headers: { ...(withCookie ? { cookie } : {}), 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(data) } : {}) });
  const agent = { session: { id: nativeAudit ? nativePointer.id : 'synthetic-audit-session', header: { cwd } } };
  ctx.emit('agent/created', { agent });
  const recordName = nativeAudit ? 'native-audit-reviewed-r72' : profileSeed ? 's05-ui-synthetic' : 'audit-reviewed';
  if (!profileSeed) {
   const data = { scope: 'project', sessionId: agent.session.id, name: recordName, description: 'Synthetic audit record', type: 'project', body: 'Synthetic fact.', expectedRevision: null };
   const created = await call('memory.write', data, 'POST'); assert.equal(created.status, 200);
   const first = (await created.json()).record;
   const reviewed = await call('memory.review', { scope: 'project', sessionId: agent.session.id, name: data.name, expectedRevision: first.revision, status: 'verified', confirm: true }, 'POST');
   assert.equal(reviewed.status, 200);
   if (policyMatrix) {
    const candidate = await call('memory.write', { ...data, name: 'audit-candidate', description: 'Synthetic unreviewed record' }, 'POST');
    assert.equal(candidate.status, 200);
    const muted = await call('memory.write', { scope: 'user', name: 'audit-muted', description: 'Synthetic muted record', type: 'reference', body: 'Synthetic muted fact.', expectedRevision: null }, 'POST');
    assert.equal(muted.status, 200);
    const mutedFirst = (await muted.json()).record;
    const mutedReviewed = await call('memory.review', { scope: 'user', name: 'audit-muted', expectedRevision: mutedFirst.revision, status: 'verified', confirm: true }, 'POST');
    assert.equal(mutedReviewed.status, 200);
    const mutedRevision = (await mutedReviewed.json()).record.revision;
    assert.equal((await call('memory.patch', { scope: 'user', name: 'audit-muted', expectedRevision: mutedRevision, disabled: true }, 'POST')).status, 200);
   }
  } else {
   const existing = await call('memory.read', { scope: 'project', sessionId: agent.session.id, name: recordName });
   assert.equal(existing.status, 200); assert.equal((await existing.json()).status, 'verified');
  }
  const before = await call('audit.events', { scope: 'project', sessionId: agent.session.id });
  assert.equal(before.status, 200);
  const baseline = (await before.json()).entries.length;
  const section = (await ctx.systemPrompt.assemble({ agent })).sections.find(item => item.name === 'memory-wh:index');
  assert.match(section.text, new RegExp(recordName));
  const auditFile = path.join(memoryDir, 'audit.jsonl');
  const readAuditLines = () => fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
  const beforeCount = readAuditLines().length;
  for (let i = 0; i < 200 && readAuditLines().length <= beforeCount; i++) await new Promise(resolve => setTimeout(resolve, 25));
  const lines = readAuditLines().map(text => JSON.parse(text));
  assert.ok(lines.length > beforeCount, 'no new audit line was appended');
  const line = lines[lines.length - 1];
  assert.equal(line.kind, 'render_attempt');
  result.auditedPluginVersion = line.pluginVersion;
  assert.match(line.pluginVersion, /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
  if (line.pluginVersion !== result.installedVersion) result.checks.push('audited pluginVersion ' + line.pluginVersion + ' differs from installed ' + result.installedVersion);
  assert.ok(line.bytes > 0 && line.injected.includes(recordName));
  if (policyMatrix) {
   assert.deepEqual([...line.injected].sort(), [recordName, 'audit-candidate'].sort());
   assert.ok(line.excluded.some(item => item.id.endsWith(':audit-muted') && item.reason === 'disabled'));
   result.checks.push('candidate synthetic record is injected; disabled one is excluded with explicit audit reason');
  }
  result.checks.push('actual prompt assembly records reviewed synthetic project memory');
  const project = await call('audit.events', { scope: 'project', sessionId: agent.session.id });
  assert.equal(project.status, 200);
  const payload = await project.json();
  assert.equal(payload.entries.length, baseline + 1);
  const event = payload.entries.find(item => item.records.some(record => record.name === recordName));
  assert.ok(event);
  assert.ok(event.bytes > 0);
  if (policyMatrix) assert.ok(event.records.some(item => item.name === 'audit-candidate'));
  result.checks.push('authenticated project audit API returns the actual render event and selected record');
  const user = await call('audit.events', { scope: 'user', sessionId: agent.session.id });
  assert.equal(user.status, 200);
  if (!profileSeed) {
   const userEvent = (await user.json()).entries[0];
   assert.deepEqual(userEvent.records, []);
   if (policyMatrix) assert.ok(userEvent.excluded.some(item => item.id.endsWith(':audit-muted') && item.reason === 'disabled'));
  }
  assert.equal((await call('audit.events', { scope: 'project', sessionId: 'unknown' })).status, 403);
  assert.equal((await call('audit.events', { scope: 'project', sessionId: agent.session.id }, 'GET', false)).status, 401);
  result.checks.push(profileSeed ? 'user view stays authenticated; unknown session and missing login are denied' : 'user view hides project record; unknown session and missing login are denied');
  if (lifecycle) {
   ctx.emit('session/disposed', agent.session);
   for (const name of ['groups.list', 'memory.read', 'audit.events']) {
    const data = { scope: 'project', sessionId: agent.session.id, ...(name === 'memory.read' ? { name: recordName } : {}) };
    assert.equal((await call(name, data)).status, 403, name);
   }
   assert.equal((await call('groups.list', { scope: 'user' })).status, 200);
   result.checks.push('session disposal revokes project list, read and audit while preserving user scope');
   ctx.emit('agent/created', { agent });
   const restored = await call('audit.events', { scope: 'project', sessionId: agent.session.id });
   assert.equal(restored.status, 200);
   assert.equal((await restored.json()).entries.length, baseline + 1);
   result.checks.push('new agent creation remaps the synthetic session and restores project audit access');
  }
  result.auditEvents = payload.entries.length;
  result.status = 'passed';
 } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
 finally { if (ctx) await ctx.fiber.dispose().catch(() => {}); fs.writeFileSync(path.join(evidence, nativeAudit ? 'native-audit-host.json' : policyMatrix ? 'policy-lifecycle.json' : lifecycle ? 'lifecycle.json' : profileSeed ? 'profile-seed.json' : 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
})();
