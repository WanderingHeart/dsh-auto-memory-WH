// Run with the installed Windows Desktop executable in ELECTRON_RUN_AS_NODE mode.
// Exercise its actual Desktop Host, not the Electron window, in a fresh synthetic profile.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const { once } = require('node:events')
const { createHash } = require('node:crypto')

const repo = resolve(__dirname, '../..')
const exe = process.execPath
const resources = join(dirname(exe), 'resources')
const runtime = join(resources, 'app.asar', 'dsh')
const pkg = name => join(runtime, 'node_modules', '@deepseek-ai', name)
const metadata = name => JSON.parse(readFileSync(join(pkg(name), 'package.json'), 'utf8'))
const bundled = name => require(join(pkg(name), metadata(name).main))
const version = metadata('dsh-desktop-host').version
assert.equal(version, '0.2.2-rc.5', 'Use the verified Windows Desktop rc.5 executable')
const tree = join(repo, '.work')
const archive = process.argv[2] ? resolve(process.argv[2]) : undefined
if (archive) assert.equal(dirname(archive), tree, 'Use a local tarball directly under .work')
mkdirSync(tree, { recursive: true })
const root = mkdtempSync(join(tree, 'desktop-host-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'desktop')
const memory = join(home, 'memory-wh')
const target = join(profile, 'node_modules', 'dsh-auto-memory-wh')
const primary = join(resources, 'runtime', 'primary-runtime')
const pnpm = join(primary, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SYSTEMROOT|WINDIR|COMSPEC|PATHEXT)$/i.test(key)))
for (const [key, sub] of Object.entries({ DSH_HOME: 'home', USERPROFILE: 'user', HOME: 'user', APPDATA: 'appdata', LOCALAPPDATA: 'localappdata', TEMP: 'tmp', TMP: 'tmp', XDG_CACHE_HOME: 'cache', XDG_CONFIG_HOME: 'config' })) {
  env[key] = join(root, sub)
  mkdirSync(env[key], { recursive: true })
}
env.PATH = join(resources, 'runtime', 'bin') + ';' + join(env.SYSTEMROOT ?? env.SystemRoot ?? 'C:/Windows', 'System32')
env.ELECTRON_RUN_AS_NODE = '1'
env.npm_config_offline = 'true'
env.npm_config_ignore_scripts = 'true'
env.npm_config_cache = join(root, 'npm-cache')
env.PNPM_HOME = join(root, 'pnpm-home')

const { PROFILE_TEMPLATES } = bundled('dsh-official-bundles')
const boot = bundled('dsh-app-boot')
const plugin = 'dsh-auto-memory-wh'
boot.initProfile(profile, [...PROFILE_TEMPLATES.web.bundles, ...(archive ? [] : [plugin])])
const profileFile = join(profile, 'package.json')
const manifest = () => JSON.parse(readFileSync(profileFile, 'utf8'))
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
function packageManager(phase, args) {
  const cli = join(pkg('dsh-desktop-host'), 'lib', 'cli.js') // same bundled entry as dsh.cmd
  const store = phase === 'peers' ? [] : ['--store-dir', join(root, 'pnpm-store')]
  const out = spawnSync(exe, ['--expose-internals', cli, 'plugin', '--profile', 'desktop', ...args, ...store], {
    cwd: root, env: { ...env, npm_config_offline: phase === 'install' ? 'false' : 'true' },
    windowsHide: true, timeout: 180000, encoding: 'utf8',
  })
  writeFileSync(join(root, phase + '.log'), (out.stdout ?? '') + (out.stderr ?? ''))
  if (out.error) throw out.error
  if (phase !== 'peers') assert.equal(out.status, 0, `${phase} failed; see ${phase}.log`)
  return out.status
}
writeFileSync(join(profile, 'cordis.patch.yml'), '- id: auto-memory-wh\n  config:\n    autoSummarize: false\n    autoMerge: false\n    autoBackup: false\n')

const entry = join(pkg('dsh-desktop-host'), 'lib', 'index.js')
async function withHost(phase, exercise) {
  const child = spawn(exe, ['--expose-internals', entry, runtime, profile, primary, pnpm, join(resources, 'runtime', 'bin')], {
    cwd: profile, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const closed = once(child, 'exit')
  let diagnostics = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-16384) })
  const ready = new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Desktop Host ready timeout')), 30000)
    function done(error, event) {
      clearTimeout(timer)
      if (error) reject(error)
      else accept(event)
    }
    child.once('error', error => done(error))
    child.once('exit', code => done(new Error(`Desktop Host exited: ${code}`)))
    child.on('message', event => {
      if (event.type === 'ready') done(undefined, event)
      if (event.type === 'fatal') done(new Error('Desktop Host reported a fatal startup error'))
    })
  })

  try {
    const { url } = await ready
    const origin = new URL(url).origin
    assert.equal(new URL(origin).hostname, '127.0.0.1')
    const get = (url, options) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), ...options })
    const login = await get(url)
    assert.equal(login.status, 303)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const shell = await get(new URL(login.headers.get('location') ?? '/', origin), { headers: { cookie } })
    assert.equal(shell.status, 200)
    const html = await shell.text()
    const route = origin + '/api/auto-memory-wh/'
    const call = (name, data, method = 'GET') => get(route + name + (method === 'GET' ? '?' + new URLSearchParams(data) : ''), {
      method, headers: { cookie, origin, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
    })
    return await exercise({ html, call, unauthenticated: () => get(route + 'groups.list?scope=user'), child })
  } finally {
    if (child.connected) child.send({ type: 'shutdown' }, () => {})
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill() }, 6000)
    await closed.catch(() => {})
    clearTimeout(timer)
    writeFileSync(join(root, phase + '.log'), diagnostics)
  }
}

async function verify() {
  const result = { desktopHost: version, node: process.versions.node, checks: [], electronWindow: 'not exercised' }
  try {
    if (archive) {
      result.archiveSha256 = hash(archive)
      packageManager('install', ['add', archive, '--ignore-scripts', '--prefer-offline'])
      assert.ok(manifest().dependencies[plugin].startsWith('file:'))
      assert.ok(manifest().dsh.profile.bundles.includes(plugin))
      for (const file of ['lib/index.js', 'lib/client.js', 'package.json', 'cordis.patch.yml']) {
        assert.equal(hash(join(target, file)), hash(join(repo, file)), file)
      }
      result.checks.push('bundled DSH CLI installed local tarball; installed build and manifest hashes match')
      result.peerCheckExit = packageManager('peers', ['peers', 'check'])
    } else {
      const m = manifest()
      m.dependencies[plugin] = '1.0.1'
      writeFileSync(profileFile, JSON.stringify(m, null, 2) + '\n')
      mkdirSync(target, { recursive: true })
      for (const file of ['lib', 'package.json', 'cordis.patch.yml']) cpSync(join(repo, file), join(target, file), { recursive: true })
    }
    await withHost('active', async ({ html, call, unauthenticated, child }) => {
      assert.ok(html.includes(plugin), 'Desktop shell did not advertise the WH client')
      assert.equal((await unauthenticated()).status, 401)
      const empty = await call('groups.list', { scope: 'user' })
      assert.equal(empty.status, 200)
      result.checks.push('real Desktop profile loader activated WH; native HTTP bridge requires authentication')
      const write = name => call('memory.write', { name, scope: 'user', type: 'reference', description: 'Synthetic description', body: 'Synthetic fact.', expectedRevision: null }, 'POST')
      assert.equal((await write('desktop-synthetic')).status, 200)
      const record = await call('memory.read', { name: 'desktop-synthetic', scope: 'user' })
      assert.equal(record.status, 200)
      assert.equal((await record.json()).body, 'Synthetic fact.')
      assert.ok(existsSync(join(memory, '_user', 'desktop-synthetic.md')))
      result.checks.push('authenticated synthetic write/read persisted in isolated WH root')
      const dead = spawnSync(exe, ['-e', ''], { cwd: profile, env, windowsHide: true, timeout: 5000 })
      assert.equal(dead.status, 0)
      assert.throws(() => process.kill(dead.pid, 0), { code: 'ESRCH' })
      const lock = join(memory, '_user', 'MEMORY.md.lock')
      writeFileSync(lock, `${dead.pid}\n`, { flag: 'wx' })
      assert.equal((await write('desktop-after-lock')).status, 200)
      assert.ok(existsSync(join(memory, '_user', 'desktop-after-lock.md')))
      assert.deepEqual(readdirSync(dirname(lock)).filter(name => name.startsWith('MEMORY.md.lock')), [])
      result.checks.push('dead-PID scope lock reclaimed; no leftover lock or claim')
      writeFileSync(lock, `${child.pid}\n`, { flag: 'wx' })
      const busy = await write('desktop-must-not-write')
      assert.equal(busy.status, 503)
      assert.equal((await busy.json()).code, 'READ_ONLY')
      assert.equal(readFileSync(lock, 'utf8'), `${child.pid}\n`)
      assert.equal(existsSync(join(memory, '_user', 'desktop-must-not-write.md')), false)
      unlinkSync(lock) // Only our synthetic lock in the isolated fixture.
      result.checks.push('live-PID scope lock preserved; write returned 503 READ_ONLY')
      const rootLock = join(memory, '.wh-writer.lock')
      writeFileSync(rootLock, `${dead.pid}\n`, { flag: 'wx' })
      const staleRoot = await write('desktop-root-lock-blocked')
      assert.equal(staleRoot.status, 503)
      assert.equal((await staleRoot.json()).code, 'READ_ONLY')
      assert.equal(readFileSync(rootLock, 'utf8'), `${dead.pid}\n`)
      assert.ok(!existsSync(join(memory, '_user', 'desktop-root-lock-blocked.md')))
      unlinkSync(rootLock) // Only our synthetic lock in the isolated fixture.
      result.checks.push('confirmed-dead root lock blocked the management pre-read without being removed')
      const index = readFileSync(join(memory, '_user', 'MEMORY.md'), 'utf8')
      assert.match(index, /desktop-synthetic\.md/)
      assert.match(index, /desktop-after-lock\.md/)
      result.checks.push('generated user prompt index contains both synthetic records')
      const response = await call('relatedness.graph', { scope: 'user', threshold: 30 }, 'POST')
      assert.equal(response.status, 200)
      const graph = await response.json()
      assert.deepEqual(graph.nodes.map(node => node.name).sort(), ['desktop-after-lock', 'desktop-synthetic'])
      assert.equal(graph.edges.length, 1)
      assert.deepEqual([graph.edges[0].from, graph.edges[0].to].sort(), ['desktop-after-lock', 'desktop-synthetic'])
      assert.deepEqual(graph.nodes.map(node => node.degree), [1, 1])
      result.checks.push('management graph endpoint returns two synthetic nodes and their single edge')
    })
    if (archive) {
      const files = ['desktop-synthetic.md', 'desktop-after-lock.md', 'MEMORY.md'].map(file => join(memory, '_user', file))
      const hashes = files.map(hash)
      const bundles = manifest().dsh.profile.bundles
      boot.writeProfileBundles(profile, manifest(), bundles.filter(name => name !== plugin))
      const inactive = async ({ html, call }) => {
        assert.ok(!html.includes(plugin))
        assert.equal((await call('groups.list', { scope: 'user' })).status, 404)
        assert.deepEqual(files.map(hash), hashes)
      }
      await withHost('disabled-restart', inactive)
      assert.ok(existsSync(join(target, 'package.json')), 'Disabling must not uninstall the package')
      result.checks.push('disabled bundle absent after restart; package and data retained')
      boot.writeProfileBundles(profile, manifest(), bundles)
      await withHost('enabled-restart', async ({ html, call }) => {
        assert.ok(html.includes(plugin))
        const response = await call('memory.read', { scope: 'user', name: 'desktop-synthetic' })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).body, 'Synthetic fact.')
        assert.deepEqual(files.map(hash), hashes)
      })
      result.checks.push('re-enabled bundle loads after restart and reads the same data')
      packageManager('uninstall', ['remove', plugin])
      assert.ok(!manifest().dependencies?.[plugin])
      assert.ok(!manifest().dsh.profile.bundles.includes(plugin))
      assert.ok(!existsSync(join(target, 'package.json')))
      await withHost('removed-restart', inactive)
      result.checks.push('bundled DSH CLI uninstalled package; a fresh host has no WH route and data hashes match')
    }
    result.status = 'passed'
  } catch (error) {
    result.status = 'failed'
    result.error = error.message
    process.exitCode = 1
  } finally {
    writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify({ ...result, evidence: root }, null, 2))
  }
}
verify()
