#!/usr/bin/env node
/**
 * 发布前最后一遍自动核对。
 *
 * 检查版本、验收/演练证据、打包内容与 npm 名称状态，写一份
 * docs/evidence/S05-release/release-readiness.json，并打印 PASS/FAIL 列表。
 * 任何一项失败都以非零退出码结束，便于在发布前最后一刻拦住问题。
 *
 * 用法：
 *   node scripts/verification/release-readiness.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-release')
mkdirSync(evidenceDir, { recursive: true })

const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const version = pkg.version
const rcMatch = version.match(/rc\.([0-9]+)/)
const candidateStage = rcMatch ? `S05-rc${rcMatch[1]}` : `S05-${version}`
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const checks = []
const check = (name, blocking, fn) => {
  try {
    const detail = fn()
    checks.push({ name, blocking, ok: true, detail })
  } catch (error) {
    checks.push({ name, blocking, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

check('version-files', true, () => {
  const identity = readFileSync(join(repo, 'src', 'identity.ts'), 'utf8')
  assert(identity.includes(`PLUGIN_VERSION = '${version}'`), `src/identity.ts 不是 ${version}`)
  const lock = readJson(join(repo, 'package-lock.json'))
  assert(lock.version === version, `lock 顶层是 ${lock.version}`)
  assert(lock.packages?.['']?.version === version, `lock packages[""] 是 ${lock.packages?.['']?.version}`)
  return `package.json / src/identity.ts / package-lock.json 均为 ${version}`
})

check('installed-isolated', true, () => {
  const installed = readJson(join(repo, '.work', 'S05', 'installation-home', 'profiles', 'wh-s05', 'node_modules', 'dsh-auto-memory-wh', 'package.json'))
  assert(installed.version === version, `wh-s05 安装的是 ${installed.version}`)
  return `wh-s05 已安装 ${version}`
})

check('changelog-entry', true, () => {
  const changelog = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')
  assert(changelog.includes(`## [${version}]`), `CHANGELOG 缺少 ## [${version}]`)
  return `CHANGELOG 含 ## [${version}]`
})

check('acceptance-current', true, () => {
  const path = join(repo, 'docs', 'evidence', `${candidateStage}-acceptance`, 'summary.json')
  assert(existsSync(path), `缺少 ${path}`)
  const summary = readJson(path)
  assert(summary.pass === true, '验收未通过')
  assert(summary.version === version, `验收版本是 ${summary.version}`)
  assert(summary.sha256 === sha256(readFileSync(join(repo, '.work', `dsh-auto-memory-wh-${version}.tgz`))), '验收包哈希不是当前候选')
  const steps = summary.steps ?? []
  assert(steps.length >= 22, `验收只有 ${steps.length} 步（rc 线要求 22）`)
  const failed = steps.filter(step => step.ok !== true && step.status !== 'pass' && step.pass !== true)
  assert(failed.length === 0, `${failed.length} 步未通过：${failed.map(step => step.name).join(', ')}`)
  return `${steps.length} 步全部通过`
})

check('edition-matrix', true, () => {
  const path = join(repo, 'docs', 'evidence', `S05-${version}-edition`, 'edition-matrix.json')
  assert(existsSync(path), `缺少 ${path}`)
  const evidence = readJson(path)
  assert(evidence.pass !== false, 'edition-matrix 未通过')
  return `三档矩阵通过（${(evidence.checks ?? []).length} 项）`
})

check('compat-matrix', true, () => {
  const evidence = readJson(join(repo, 'docs', 'evidence', 'S05-release', 'compat-matrix.json'))
  assert(evidence.pass === true, 'compat-matrix 未通过')
  return 'DSH/Node/8 peers 兼容矩阵通过'
})

check('clean-env-drill', true, () => {
  const evidence = readJson(join(repo, 'docs', 'evidence', 'S05-release', 'clean-env-drill.json'))
  assert(evidence.pass === true, '干净环境演练未通过')
  assert(evidence.versions?.upgraded === version, '干净环境演练不是当前候选')
  return `干净环境 ${evidence.versions.installed} → ${evidence.versions.upgraded} → 回滚，摘要 ${String(evidence.digests?.afterUpgrade ?? '').slice(0, 16)}…`
})

check('license-audit', true, () => {
  const node = process.execPath
  const out = execFileSync(node, [join(repo, 'scripts', 'verification', 'runtime-license-audit.mjs'), version], { cwd: repo, encoding: 'utf8' })
  const result = JSON.parse(out.slice(out.indexOf('{')))
  assert(result.pass === true, '许可审计未通过')
  return `${result.noticeConsistency?.noticeRows ?? '?'} 条许可行与 lock 一致`
})

check('release-docs', true, () => {
  for (const path of ['docs/attachments/release.md', 'docs/progress/2026-11-15_001_dsh-auto-memory-wh_结题报告（1.0.0-rc.17）.md', 'docs/attachments/user-guide.md', 'README.md', 'CHANGELOG.md']) {
    assert(existsSync(join(repo, path)), `缺少 ${path}`)
  }
  return '统一发布报告 / 结题报告 / 用户指南 / README / CHANGELOG 均在位'
})

check('package-contents', true, () => {
  const node = process.execPath
  const npmCli = join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const raw = execFileSync(node, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: repo, encoding: 'utf8' })
  const meta = JSON.parse(raw.slice(raw.indexOf('[')))[0]
  assert(meta.entryCount === 15 || meta.files?.length === 15, `包内 ${meta.entryCount ?? meta.files?.length} 个文件（期望 15）`)
  const names = (meta.files ?? []).map(file => file.path)
  for (const required of ['lib/index.js', 'lib/client.js', 'LICENSE', 'UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'cordis.patch.yml']) {
    assert(names.includes(required), `包内缺少 ${required}`)
  }
  return `${meta.entryCount ?? meta.files?.length} 个文件，${meta.size} 字节`
})

check('candidate-evidence', true, () => {
  const dir = join(repo, 'docs', 'evidence', candidateStage)
  const packed = readJson(join(dir, 'package.json'))
  const candidate = Array.isArray(packed) ? packed[0] : packed
  assert(candidate.version === version, `候选证据版本是 ${candidate.version}`)
  const hashes = readJson(join(dir, 'hashes.json'))
  assert(hashes.version === version, `hashes 版本是 ${hashes.version}`)
  const tgz = join(repo, '.work', hashes.archive)
  assert(existsSync(tgz), `缺少 ${tgz}`)
  const bytes = readFileSync(tgz)
  assert(bytes.length === hashes.size, `tgz 大小 ${bytes.length} ≠ 证据 ${hashes.size}`)
  assert(sha256(bytes) === hashes.sha256, 'tgz 哈希与证据不一致')
  const libEntry = (candidate.files ?? []).find(file => file.path === 'lib/index.js')
  assert(libEntry !== undefined, '候选清单缺少 lib/index.js')
  const libBytes = readFileSync(join(repo, 'lib', 'index.js'))
  assert(libBytes.length === libEntry.size, `lib/index.js 大小 ${libBytes.length} ≠ 候选 ${libEntry.size}（切版后是否重新构建？）`)
  return `${hashes.archive}，${hashes.size} 字节，哈希与 lib 大小一致`
})

check('npm-name-available', true, () => {
  const node = process.execPath
  const npmCli = join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  try {
    execFileSync(node, [npmCli, 'view', pkg.name, 'version'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    const text = String(error?.stderr ?? '') + String(error?.stdout ?? '') + String(error?.message ?? '')
    if (text.includes('E404') || text.includes('404 Not Found')) return `${pkg.name} 在 npm 上尚未被占用`
    throw new Error(`无法确认名称状态：${text.split('\n')[0] ?? error}`)
  }
  const owner = execFileSync(node, [npmCli, 'whoami', '--registry=https://registry.npmjs.org'], { encoding: 'utf8' }).trim()
  const maintainers = JSON.parse(execFileSync(node, [npmCli, 'view', pkg.name, 'maintainers', '--json', '--registry=https://registry.npmjs.org'], { encoding: 'utf8' }))
  assert(maintainers.some(item => (typeof item === 'string' ? item.split(' ')[0] : item.name) === owner), '当前账号不在维护者列表')
  const versions = JSON.parse(execFileSync(node, [npmCli, 'view', pkg.name, 'versions', '--json', '--registry=https://registry.npmjs.org'], { encoding: 'utf8' }))
  assert(!(Array.isArray(versions) ? versions : [versions]).includes(version), '目标版本已经发布')
  return `${owner} 是维护者，${version} 尚未发布`
})

const failed = checks.filter(item => !item.ok && item.blocking)
const evidence = {
  kind: 'release-readiness',
  at: new Date().toISOString(),
  version,
  pass: failed.length === 0,
  checks,
}
writeFileSync(join(evidenceDir, 'release-readiness.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

console.log(`release readiness — ${pkg.name}@${version}`)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
console.log(`\n${evidence.pass ? 'READY' : 'BLOCKED'} (${checks.filter(item => item.ok).length}/${checks.length} checks)`)
console.log(`evidence: docs/evidence/S05-release/release-readiness.json`)
process.exit(evidence.pass ? 0 : 1)
