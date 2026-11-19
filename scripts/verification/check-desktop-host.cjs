// Run with the installed Windows Desktop executable in ELECTRON_RUN_AS_NODE mode.
// Exercise its actual Desktop Host, not the Electron window, in a fresh synthetic profile.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const { once } = require('node:events')

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

const { PROFILE_TEMPLATES } = bundled('dsh-official-bundles')
bundled('dsh-app-boot').initProfile(profile, [...PROFILE_TEMPLATES.web.bundles, 'dsh-auto-memory-wh'])
const profileFile = join(profile, 'package.json')
const manifest = JSON.parse(readFileSync(profileFile, 'utf8'))
manifest.dependencies['dsh-auto-memory-wh'] = '1.0.1'
writeFileSync(profileFile, JSON.stringify(manifest, null, 2) + '\n')
mkdirSync(target, { recursive: true })
// Provision only the built package, not the repository or its npm dependency tree.
for (const name of ['lib', 'package.json', 'cordis.patch.yml']) cpSync(join(repo, name), join(target, name), { recursive: true })
const bundle = join(target, 'cordis.patch.yml')
assert.match(readFileSync(bundle, 'utf8'), /name: dsh-auto-memory-wh/)
writeFileSync(bundle, readFileSync(bundle, 'utf8') + '      config:\n        autoSummarize: false\n        autoMerge: false\n        autoBackup: false\n')

const entry = join(pkg('dsh-desktop-host'), 'lib', 'index.js')
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

async function verify() {
  const result = { desktopHost: version, node: process.versions.node, checks: [], electronWindow: 'not exercised' }
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
    assert.ok(html.includes('dsh-auto-memory-wh'), 'Desktop shell did not advertise the WH client')
    result.checks.push('authenticated Desktop web shell advertises the WH client bundle')
    const route = origin + '/api/auto-memory-wh/'
    const call = (name, data, method = 'GET') => get(route + name + (method === 'GET' ? '?' + new URLSearchParams(data) : ''), {
      method, headers: { cookie, origin, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
    })
    assert.equal((await get(route + 'groups.list?scope=user')).status, 401)
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
    assert.ok(busy.status >= 400)
    assert.equal(readFileSync(lock, 'utf8'), `${child.pid}\n`)
    assert.equal(existsSync(join(memory, '_user', 'desktop-must-not-write.md')), false)
    result.checks.push('live-PID scope lock preserved and write refused')
    result.status = 'passed'
  } catch (error) {
    result.status = 'failed'
    result.error = error.message
    process.exitCode = 1
  } finally {
    if (child.connected) child.send({ type: 'shutdown' }, () => {})
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill() }, 6000)
    await closed.catch(() => {})
    clearTimeout(timer)
    // Keep raw diagnostics local; they may contain a short-lived loopback credential.
    writeFileSync(join(root, 'host.log'), diagnostics)
    writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify({ ...result, evidence: root }, null, 2))
  }
}
verify()
