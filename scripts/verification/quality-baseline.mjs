/**
 * v0.6.0 质量度量基线(只读):扫描真实记忆根,统计规模/构成/质量提示/近重复/索引占用。
 * 不写任何记忆文件;只把结果写到 docs/evidence/S05-v060-quality/baseline.json。
 *
 * 用法:node scripts/verification/quality-baseline.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { MemoryStore } from '../../src/store.ts'
import { listProjects } from '../../src/projects.ts'
import { qualityReport } from '../../src/quality.ts'
import { findNearDuplicateGroups } from '../../src/duplicates.ts'
import { renderMemoryIndexDetail } from '../../src/injection.ts'

const repo = process.cwd()
const root = process.env.WH_MEMORY_ROOT ?? join(homedir(), '.dsh', 'memory-wh')
const store = new MemoryStore(root)
const now = Date.now()

const projects = listProjects(root)
const cwds = new Set()
for (const project of projects.projects) cwds.add(project.cwd)
if (cwds.size === 0) cwds.add(process.cwd())

const byPath = new Map()
for (const cwd of cwds) {
  for (const record of await store.listAll(cwd)) {
    byPath.set(`${record.scope}:${record.name}`, record)
  }
}
const records = [...byPath.values()]

const count = (key) => {
  const out = {}
  for (const record of records) {
    const value = key(record) ?? 'unknown'
    out[value] = (out[value] ?? 0) + 1
  }
  return out
}

const report = qualityReport(records, now)
const duplicates = findNearDuplicateGroups(records, { threshold: 0.8 })
const byScope = count(record => record.scope)
const userRecords = records.filter(record => record.scope === 'user')
const index = (() => {
  try {
    const detail = renderMemoryIndexDetail(store, { enableUserScope: true, maxBytes: 4096 }, cwds.values().next().value)
    return { bytes: detail.textBytes, budget: 4096, excluded: detail.excluded.length }
  } catch (error) {
    return { error: String(error) }
  }
})()

const baseline = {
  stage: 'S05-v060-quality',
  kind: 'quality-baseline',
  at: new Date(now).toISOString(),
  memoryRoot: root,
  projects: projects.projects.length,
  records: records.length,
  byScope,
  byType: count(record => record.type),
  byStatus: count(record => record.status ?? 'legacy'),
  verifiedUser: userRecords.filter(record => record.status === 'verified').length,
  flagged: report.flagged,
  byCode: report.byCode,
  duplicateGroups: duplicates.length,
  index,
}

const dir = join(repo, 'docs', 'evidence', 'S05-v060-quality')
mkdirSync(dir, { recursive: true })
const target = join(dir, 'baseline.json')
writeFileSync(target, JSON.stringify(baseline, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(baseline, null, 2))
console.log(`WROTE ${target}`)
