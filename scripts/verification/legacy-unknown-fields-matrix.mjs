#!/usr/bin/env node
/**
 * T01 complement: legacy store + unknown frontmatter field matrix.
 *
 * Covers the gaps left by r01/r92:
 *   - unknown scalar/nested/array frontmatter fields survive parse -> write -> parse;
 *   - invalid known fields are tolerated (ignored), never fatal;
 *   - a marker-less "legacy" root is fail-closed for live reads but migratable,
 *     and migration bootstraps `.wh-format.json` while keeping record bytes;
 *   - unsupported marker version / record schemaVersion / enum values block
 *     migration with explicit inventory issues instead of silent repair;
 *   - archive -> restore keeps unknown metadata bytes intact.
 *
 * Synthetic roots only. No live profile is touched.
 *
 * Usage: node scripts/verification/legacy-unknown-fields-matrix.mjs [stage]
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MemoryStore, migrationRecordIssue, parseMemory, serializeMemory } from '../../src/store.ts'
import { applyMigration, inventoryRoot, planMigration } from '../../src/maintenance.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const stage = process.argv[2] ?? 'S05-rc11-legacy-unknown'
const evidenceDir = join(repoRoot, 'docs', 'evidence', stage)
const evidenceFile = join(evidenceDir, 'result.json')
const selection = { includeAudit: false, includeArchive: false }
const results = []

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function ok(condition, detail) {
  if (!condition) throw new Error(detail)
}

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, status: 'passed', detail: detail ?? null })
  } catch (error) {
    results.push({ name, status: 'failed', detail: String(error?.stack ?? error) })
  }
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n')
}

const marker = JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }) + '\n'

async function makeRoot(dir, { withMarker = true } = {}) {
  await mkdir(join(dir, '_user'), { recursive: true })
  if (withMarker) await writeFile(join(dir, '.wh-format.json'), marker)
  return dir
}

function recordRaw({ name = 'unknown-fields', description = '旧库未知字段样本', body = '正文第一行\n第二行', extra = '' } = {}) {
  return `---\nname: ${name}\ndescription: ${description}\ntype: reference\nownerNote: 随记录保留的未知字段\nnested:\n  a: 1\n  list:\n    - x\n    - y\nlegacyFlag: true\n${extra}---\n\n${body}\n`
}

const runRoot = await mkdtemp(join(repoRoot, '.work', 'S05', 'legacy-unknown-'))
const original = recordRaw()

await check('unknown fields are captured into metadata by parseMemory', async () => {
  const record = parseMemory(original, 'user')
  ok(record !== null, 'record should parse')
  ok(record.metadata.ownerNote === '随记录保留的未知字段', 'ownerNote missing')
  ok(record.metadata.nested.a === 1 && Array.isArray(record.metadata.nested.list), 'nested unknown lost')
  ok(record.metadata.legacyFlag === true, 'legacyFlag missing')
  return { metadataKeys: Object.keys(record.metadata).sort() }
})

await check('serializeMemory round-trips unknown metadata', async () => {
  const first = parseMemory(original, 'user')
  const second = parseMemory(serializeMemory(first), 'user')
  ok(second !== null, 're-parse failed')
  ok(JSON.stringify(second.metadata) === JSON.stringify(first.metadata), 'metadata changed in round-trip')
  ok(second.body === first.body, 'body changed in round-trip')
  ok(second.description === first.description, 'description changed in round-trip')
})

await check('invalid known lifecycle fields are ignored without throwing', async () => {
  const raw = recordRaw({ extra: 'created: not-a-number\nupdated: -5\nreads: -1\nimportance: 99\n' })
  const record = parseMemory(raw, 'user')
  ok(record !== null, 'should tolerate invalid known fields')
  ok(record.createdMs === undefined && record.updatedMs === undefined, 'invalid timestamps must be ignored')
  ok(record.reads === undefined && record.importance === undefined, 'invalid counters must be ignored')
  ok(!('created' in record.metadata), 'known key must not leak into metadata')
})

await check('prototype-looking unknown keys do not pollute Object.prototype', async () => {
  const raw = recordRaw({ extra: '__proto__: { polluted: true }\n' })
  const record = parseMemory(raw, 'user')
  ok(record !== null, 'should parse')
  ok({}.polluted === undefined, 'prototype polluted')
})

await check('store.write preserves unknown metadata across an update', async () => {
  const root = await makeRoot(join(runRoot, 'preserve'))
  const store = new MemoryStore(root)
  const parsed = parseMemory(original, 'user')
  ok(parsed !== null, 'seed parse failed')
  const written = await store.write({
    name: parsed.name,
    description: parsed.description,
    type: parsed.type,
    body: parsed.body,
    metadata: parsed.metadata,
    status: 'candidate',
  }, 'user')
  ok(written !== null, 'write failed')
  const rawAfterWrite = await readFile(join(root, '_user', 'unknown-fields.md'), 'utf8')
  ok(rawAfterWrite.includes('ownerNote'), 'unknown field dropped by write')

  const again = await store.read('unknown-fields', 'user')
  ok(again !== null, 'read failed')
  const updated = await store.write({
    name: again.name,
    description: '更新后的摘要',
    type: again.type,
    body: '更新后的正文',
    metadata: again.metadata,
    status: 'candidate',
    expectedRevision: again.revision,
  }, 'user')
  ok(updated !== null, 'update failed')
  const rawAfterUpdate = await readFile(join(root, '_user', 'unknown-fields.md'), 'utf8')
  ok(rawAfterUpdate.includes('ownerNote') && rawAfterUpdate.includes('legacyFlag'), 'unknown metadata lost on content update')
  return { metadataKeys: Object.keys(updated.metadata).sort() }
})

await check('marker-less legacy root yields no trusted records live', async () => {
  const root = await makeRoot(join(runRoot, 'legacy-markerless'), { withMarker: false })
  await writeFile(join(root, '_user', 'legacy-note.md'), recordRaw({ name: 'legacy-note' }))
  const store = new MemoryStore(root)
  const scanned = store.scanSync('user')
  ok(scanned.records.length === 0, 'no records may be trusted without marker')
  // ENOENT on the marker is treated as an uninitialized store: empty, no issue.
  // Management API independently marks a non-empty marker-less root read-only.
  ok(scanned.issues.length === 0 || scanned.issues.includes('storage-unavailable'), 'unexpected issues: ' + scanned.issues.join('; '))
  return { records: 0, issues: scanned.issues }
})

await check('inventory accepts marker-less legacy records (migration reads them)', async () => {
  const root = await makeRoot(join(runRoot, 'legacy-migration'), { withMarker: false })
  await writeFile(join(root, '_user', 'legacy-note.md'), recordRaw({ name: 'legacy-note' }))
  const inventory = await inventoryRoot(root, selection)
  ok(inventory.issues.length === 0, 'unexpected inventory issues: ' + inventory.issues.join('; '))
  ok(inventory.entries.some(e => e.kind === 'record' && e.path === '_user/legacy-note.md'), 'legacy record missing from inventory')
  ok(!inventory.entries.some(e => e.path === '.wh-format.json'), 'format entry must be absent')
  return { scopes: inventory.scopes }
})

await check('migration bootstraps the format marker and keeps record bytes', async () => {
  const root = await makeRoot(join(runRoot, 'legacy-migrate-run'), { withMarker: false })
  const raw = recordRaw({ name: 'legacy-note' })
  await writeFile(join(root, '_user', 'legacy-note.md'), raw)
  const target = join(runRoot, 'legacy-migrate-target')
  const backup = join(runRoot, 'legacy-migrate-backup')
  const plan = await planMigration({ source: root, target, backup, selection })
  ok(plan.inventory.issues.length === 0, 'plan issues: ' + plan.inventory.issues.join('; '))
  await applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true })
  ok(existsSync(join(target, '.wh-format.json')), 'format marker not bootstrapped')
  const targetRaw = await readFile(join(target, '_user', 'legacy-note.md'))
  ok(sha256(targetRaw) === sha256(raw), 'record bytes changed during migration')
  const store = new MemoryStore(target)
  const scanned = store.scanSync('user')
  ok(scanned.issues.length === 0, 'migrated root not readable: ' + scanned.issues.join('; '))
  ok(scanned.records.length === 1 && scanned.records[0].metadata.ownerNote !== undefined, 'unknown metadata missing after migration')
  return { targetHasMarker: true, recordSha: sha256(targetRaw) }
})

await check('unsupported marker version blocks inventory and migration', async () => {
  const root = await makeRoot(join(runRoot, 'marker-v2'), { withMarker: false })
  await writeFile(join(root, '.wh-format.json'), JSON.stringify({ format: 'dsh-auto-memory-wh', version: 2 }) + '\n')
  await writeFile(join(root, '_user', 'legacy-note.md'), recordRaw({ name: 'legacy-note' }))
  const inventory = await inventoryRoot(root, selection)
  ok(inventory.issues.some(issue => issue.startsWith('unsupported-format: .wh-format.json')), 'missing unsupported-format issue')
  const plan = await planMigration({ source: root, target: join(runRoot, 'marker-v2-target'), backup: join(runRoot, 'marker-v2-backup'), selection })
  ok(plan.inventory.issues.length > 0, 'plan must carry the issue')
  let refused = false
  try {
    await applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true })
  } catch (error) {
    refused = String(error).includes('unresolved issues')
  }
  ok(refused, 'apply must refuse a plan with issues')
})

await check('record schemaVersion 2 is parsed but blocks migration', async () => {
  const root = await makeRoot(join(runRoot, 'record-v2'))
  const raw = recordRaw({ name: 'future-record', extra: 'schemaVersion: 2\n' })
  await writeFile(join(root, '_user', 'future-record.md'), raw)
  const parsed = parseMemory(raw, 'user')
  ok(parsed !== null, 'tolerant reader should still parse')
  ok(migrationRecordIssue(raw) === 'unsupported-record-version', 'strict migration reader must flag version')
  const inventory = await inventoryRoot(root, selection)
  ok(inventory.issues.some(issue => issue.startsWith('unsupported-record-version: _user/future-record.md')), 'inventory issue missing')
})

await check('invalid trust status is tolerated live but blocks migration', async () => {
  const root = await makeRoot(join(runRoot, 'bad-status'))
  const raw = recordRaw({ name: 'odd-status', extra: 'status: totally-unknown\n' })
  await writeFile(join(root, '_user', 'odd-status.md'), raw)
  const parsed = parseMemory(raw, 'user')
  ok(parsed !== null && parsed.status === undefined, 'invalid status must fall back to undefined')
  ok(migrationRecordIssue(raw) === 'invalid-trust-status', 'migration must flag invalid trust status')
  const inventory = await inventoryRoot(root, selection)
  ok(inventory.issues.some(issue => issue.startsWith('invalid-trust-status: _user/odd-status.md')), 'inventory issue missing')
})

await check('malformed origin is dropped live but blocks migration', async () => {
  const root = await makeRoot(join(runRoot, 'bad-origin'))
  const raw = recordRaw({ name: 'odd-origin', extra: 'origin:\n  kind: claude-code\n  slug: x\n' })
  await writeFile(join(root, '_user', 'odd-origin.md'), raw)
  const parsed = parseMemory(raw, 'user')
  ok(parsed !== null && parsed.origin === undefined, 'malformed origin must be dropped')
  ok(migrationRecordIssue(raw) === 'unrecognized-origin', 'migration must flag malformed origin')
  const inventory = await inventoryRoot(root, selection)
  ok(inventory.issues.some(issue => issue.startsWith('unrecognized-origin: _user/odd-origin.md')), 'inventory issue missing')
})

await check('archive -> restore keeps unknown metadata bytes', async () => {
  const root = await makeRoot(join(runRoot, 'archive-roundtrip'))
  const store = new MemoryStore(root)
  const parsed = parseMemory(recordRaw({ name: 'archived-note' }), 'user')
  const written = await store.write({
    name: parsed.name,
    description: parsed.description,
    type: parsed.type,
    body: parsed.body,
    metadata: parsed.metadata,
    status: 'candidate',
  }, 'user')
  const file = join(root, '_user', 'archived-note.md')
  const beforeSha = sha256(await readFile(file))
  const { archiveId } = await store.deleteVersioned('archived-note', 'user', undefined, written.revision)
  await store.restoreArchived(archiveId, 'user')
  const afterSha = sha256(await readFile(file))
  ok(beforeSha === afterSha, 'archive/restore changed bytes')
  const restored = parseMemory(await readFile(file, 'utf8'), 'user')
  ok(restored.metadata.ownerNote !== undefined && restored.metadata.legacyFlag === true, 'unknown metadata lost in archive restore')
  return { archiveId, sha: afterSha }
})

await check('CRLF frontmatter is parsed without losing unknown fields', async () => {
  const raw = '---\r\nname: crlf-note\r\ndescription: CRLF 样本\r\ntype: reference\r\nownerNote: 保留\r\n---\r\n\r\n正文\r\n'
  const parsed = parseMemory(raw, 'user')
  ok(parsed !== null, 'CRLF record must parse')
  ok(parsed.metadata.ownerNote === '保留', 'unknown field lost with CRLF')
  ok(parsed.body === '正文', 'body not trimmed as expected')
})

const passed = results.filter(r => r.status === 'passed').length
const failed = results.length - passed
const payload = {
  stage,
  at: new Date().toISOString(),
  runRoot,
  synthetic: true,
  checks: results,
  summary: { total: results.length, passed, failed },
  pass: failed === 0,
}

await mkdir(evidenceDir, { recursive: true })
await writeJson(evidenceFile, payload)
for (const result of results) {
  console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.name}`)
  if (result.status === 'failed') console.log('  ' + result.detail)
}
console.log(`\n${passed}/${results.length} checks passed`)
console.log(payload.pass ? `RESULT PASS -> ${evidenceFile}` : 'RESULT FAIL')
if (failed > 0) process.exitCode = 1
