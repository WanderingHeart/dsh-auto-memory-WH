/**
 * v0.2.0 autoSummarize 评估入口:跑合成语料,把用例级结果写成证据 JSON。
 * 只用真实 MemoryStore + 候选批,不需要模型路由(模型输出以语料形式提供)。
 *
 * 用法:node scripts/verification/autosummarize-eval.mjs [stage]
 * 证据:docs/evidence/<stage>/eval.json(默认 stage S05-v020-autosummarize)
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..', '..')
const stage = process.argv[2] ?? 'S05-v020-autosummarize'
const outFile = path.join(repo, '.work', 'autosummarize-eval-vitest.json')
const evidenceDir = path.join(repo, 'docs', 'evidence', stage)
const evidenceFile = path.join(evidenceDir, 'eval.json')
const vitest = path.join(repo, 'node_modules', 'vitest', 'vitest.mjs')

if (!fs.existsSync(vitest)) {
  console.error(`vitest not found at ${vitest}`)
  process.exit(2)
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.rmSync(outFile, { force: true })

const startedAt = Date.now()
const run = spawnSync(process.execPath, [
  vitest,
  'run',
  'tests/autosummarize-corpus.spec.ts',
  '--reporter=json',
  `--outputFile=${outFile}`,
], { cwd: repo, encoding: 'utf8', timeout: 180_000 })

const durationMs = Date.now() - startedAt
if (!fs.existsSync(outFile)) {
  console.error('vitest did not produce JSON output')
  console.error((run.stderr ?? '').slice(-2000))
  process.exit(run.status ?? 1)
}

const report = JSON.parse(fs.readFileSync(outFile, 'utf8'))
const cases = []
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    cases.push({ title: assertion.title, status: assertion.status, durationMs: assertion.duration ?? null })
  }
}
const summary = {
  stage,
  pass: (report.numFailedTests ?? 1) === 0 && (report.numTotalTests ?? 0) > 0,
  total: report.numTotalTests ?? cases.length,
  passed: report.numPassedTests ?? cases.filter(c => c.status === 'passed').length,
  failed: report.numFailedTests ?? cases.filter(c => c.status === 'failed').length,
  durationMs,
  vitestExitCode: run.status,
  at: new Date().toISOString(),
  corpus: 'tests/fixtures/autosummarize/corpus.json',
  cases,
  boundary: 'Synthetic transcripts and candidate batches only; no live model call. The corpus asserts decisions (create/update/supersede/dedupe/chitchat/importance/scope/evidence), not model quality.',
}
fs.mkdirSync(evidenceDir, { recursive: true })
fs.writeFileSync(evidenceFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(`RESULT ${summary.pass ? 'PASS' : 'FAIL'} (${summary.passed}/${summary.total}) -> ${path.relative(repo, evidenceFile)}`)
process.exit(summary.pass ? 0 : 1)
