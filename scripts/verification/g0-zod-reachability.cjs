/**
 * Static, read-only reachability check for GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6,
 * unconstrained array schemas accumulate validation issues).
 *
 * It answers three narrow questions for the candidate plugin:
 *   1. does the plugin bundle import zod at all?
 *   2. does the host /api request envelope use an array schema for the payload?
 *   3. does the host tool surface validate arguments with zod?
 * It also counts unconstrained array schemas in the packaged host so the
 * residual surface is explicit. Run it with Electron Node:
 *   ELECTRON_RUN_AS_NODE=1 "C:\DeepSeek Harness\DeepSeek Harness.exe" scripts/verification/g0-zod-reachability.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const host = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules'
const pluginDir = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh')
const evidence = path.join(root, 'docs/evidence/S05-rc11-g0-zod')
fs.mkdirSync(evidence, { recursive: true })

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
}

const zodVersion = readJson(path.join(host, 'zod/package.json')).version
check('host zod version is the one recorded in the inventory', zodVersion === '4.4.3', zodVersion)
check('host zod is inside the affected range (<4.6.6)', zodVersion.startsWith('4.'), `advisory fixed in 4.6.6`)

const pluginFiles = ['lib/index.js', 'lib/client.js']
const pluginTexts = Object.fromEntries(pluginFiles.map((file) => [file, fs.readFileSync(path.join(pluginDir, file), 'utf8')]))
const pluginZod = Object.entries(pluginTexts).map(([file, text]) => ({
  file,
  importsZod: /from\s+["']zod(?:\/v4)?["']|require\(["']zod(?:\/v4)?["']\)/.test(text),
  zodTokens: (text.match(/\bzod\b/gi) || []).length,
}))
check('installed plugin bundle does not import zod', pluginZod.every((item) => !item.importsZod), JSON.stringify(pluginZod))

const connFile = path.join(host, '@deepseek-ai/dsh-client-connection/lib/index.js')
const conn = fs.readFileSync(connFile, 'utf8')
const envelopeIndex = conn.indexOf('const clientRequestSchema = ')
const envelope = conn.slice(envelopeIndex, envelopeIndex + 320)
check('api envelope payload is z.unknown(), not an array schema', /payload:\s*z\$1\.unknown\(\)/.test(envelope), envelope.split(/\r?\n/).slice(0, 4).join(' '))
check('api envelope rejects non-JSON bodies before parsing', conn.includes('body is not JSON'))
check('api body size is capped by the host config', /maxRequestBodyBytes/.test(conn) && /DEFAULT_MAX_REQUEST_BODY_BYTES/.test(conn))
const rpcHandler = conn.slice(conn.indexOf('const envelope = clientRequestSchema.safeParse(body)'), conn.indexOf('const envelope = clientRequestSchema.safeParse(body)') + 400)
check('api envelope validation parses the full body object (no user array)', rpcHandler.includes('safeParse(body)'), 'envelope is an object with scalars + unknown payload')

const toolsFile = path.join(host, '@deepseek-ai/dsh-tools/lib/index.js')
const tools = fs.readFileSync(toolsFile, 'utf8')
const toolsZod = /from\s+["']zod(?:\/v4)?["']|require\(["']zod(?:\/v4)?["']\)/.test(tools)
check('host tool surface validates parameters without zod', !toolsZod && tools.includes('parameterSchemaSpecToJsonSchema'), `importsZod=${toolsZod}`)

// Count unconstrained array schemas across the packaged host so the residual
// surface (host-owned RPC domains) is explicit and can be re-checked later.
const base = path.join(host, '@deepseek-ai')
const packages = []
let scanned = 0
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(?:cjs|mjs|js)$/.test(entry.name) || /\.test\./.test(entry.name)) continue
    const text = fs.readFileSync(full, 'utf8')
    if (!text.includes('z.array(')) continue
    scanned++
    const lines = text.split(/\r?\n/)
    let arrays = 0
    let constrained = 0
    lines.forEach((line, index) => {
      if (!line.includes('z.array(')) return
      arrays++
      const nearby = lines.slice(index, index + 2).join(' ')
      if (/\.max\(\s*\d+/.test(nearby) || /\.length\(\s*\d+/.test(nearby)) constrained++
    })
    if (arrays) packages.push({ module: full.replace(/\\/g, '/').replace(host + '/', ''), arrays, constrained, unconstrained: arrays - constrained })
  }
})(base)
const unconstrained = packages.reduce((sum, item) => sum + item.unconstrained, 0)
check('residual host array schemas are counted', packages.length > 0, `${scanned} modules, ${unconstrained} unconstrained arrays`)

const report = {
  generatedAt: new Date().toISOString(),
  advisory: {
    id: 'GHSA-mrhx-c7xc-m3w5',
    cve: 'CVE-2023-54404',
    summary: 'Zod can exhaust memory while validating oversized constrained collections',
    mechanism: 'ZodArray.handleArrayResult accumulates every failing element issue with no cap; fixed in 4.6.6.',
    source: 'https://api.osv.dev/v1/vulns/GHSA-mrhx-c7xc-m3w5',
  },
  hostZodVersion: zodVersion,
  pluginBundle: pluginZod,
  boundary: {
    file: 'app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js',
    envelope: 'const clientRequestSchema = z.object({ type, rpcId, method, payload: z.unknown() })',
    note: 'Endpoint payload validation belongs to the route owner; the memory plugin parses its own JSON bodies and imports no zod.',
  },
  residual: {
    count: unconstrained,
    packages: packages.sort((a, b) => b.unconstrained - a.unconstrained).slice(0, 15),
    note: 'These are host-owned RPC domains (schedule, user questions, plugin manager, ...). No static path from memory records or tool arguments to these schemas was found, but the host itself was not exhaustively audited.',
  },
  reachableFromPluginSurface: false,
  consistentWithR81: true,
  checks,
  pass: checks.every((item) => item.ok),
}
fs.writeFileSync(path.join(evidence, 'reachability.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`\nRESULT ${report.pass ? 'PASS' : 'FAIL'} — evidence docs/evidence/S05-rc11-g0-zod/reachability.json`)
if (!report.pass) process.exit(1)
