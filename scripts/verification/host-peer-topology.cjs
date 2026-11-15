// Read-only peer topology inspection in the packaged Electron Node runtime.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const profile = path.join(root, '.work/S05/installation-home/profiles/wh-s05');
const installed = path.join(profile, 'node_modules/dsh-auto-memory-wh/package.json');
const manifest = JSON.parse(fs.readFileSync(installed, 'utf8'));
const host = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/';
const peers = Object.entries(manifest.peerDependencies).map(([name, wanted]) => {
  const local = path.join(profile, 'node_modules', ...name.split('/'));
  const hostMeta = JSON.parse(fs.readFileSync(host + name + '/package.json', 'utf8'));
  const rangeMatches = name === '@deepseek-ai/cordis' ? /^4\./.test(hostMeta.version) : wanted.split(' || ').includes(hostMeta.version);
  return { name, wanted, profileLocalPresent: fs.existsSync(local), packagedHostVersion: hostMeta.version, rangeMatches };
});
const result = { status: 'running', installedVersion: manifest.version, peers, scope: 'Read-only profile-local versus packaged host package metadata; no global module resolution or runtime load claim.' };
try {
  assert.equal(manifest.version, '0.1.0-rc.3');
  assert.equal(peers.length, 8);
  assert.ok(peers.every(item => !item.profileLocalPresent && item.rangeMatches));
  result.status = 'passed';
} catch (error) { result.status = 'failed'; result.error = error.message; process.exitCode = 1; }
fs.writeFileSync(path.join(root, 'docs/evidence/S05-rc3-followup/peer-topology.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, peers: peers.length, matched: peers.filter(item => item.rangeMatches).length }));
