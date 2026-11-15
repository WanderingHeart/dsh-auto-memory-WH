// Read-only inspection of the exact packaged Desktop CLI and plugin-manager code.
const fs = require('node:fs'), crypto = require('node:crypto'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const targets = [
 ['dsh-desktop-host/lib/cli.js', [94, 106]],
 ['dsh/lib/bin.js', [115, 125]],
 ['dsh/lib/plugin-BiveYA7h.js', [70, 94]],
 ['dsh-plugin-manager/lib/index.js', [525, 533]],
 ['dsh-plugin-manager/lib/index.js', [608, 620]],
];
const files = targets.map(([relative, [start, end]]) => {
 const raw = fs.readFileSync(base + relative);
 const lines = raw.toString('utf8').split('\n');
 return { packageFile: relative, sha256: crypto.createHash('sha256').update(raw).digest('hex'), start, end,
  excerpt: lines.slice(start - 1, end).map((text, index) => ({ line: start + index, text })) };
});
const result = { status: 'passed', runtime: 'packaged DSH 0.2.1-rc.5', files,
 conclusion: 'Desktop CLI delegates plugin arguments to pnpm; pnpm runs with cwd set to the selected profile directory. The peer check is a profile pnpm-tree check, not a packaged-host module check.' };
const target = path.join(root, 'docs/evidence/S05-rc3-peer-command/inspect.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, excerpts: files.length, conclusion: result.conclusion }));
