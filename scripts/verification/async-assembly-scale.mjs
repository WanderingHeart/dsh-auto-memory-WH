import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../../src/index.ts'

const root = path.resolve(import.meta.dirname, '../..')
const work = path.join(root, '.work/S05')
const fixtures = (await fs.readdir(work, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name.startsWith('scale-'))
  .map(entry => path.join(work, entry.name))
const chosen = (await Promise.all(fixtures.map(async candidate => ({ candidate, stat: await fs.stat(candidate) }))))
  .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  .find(({ candidate }) => candidate)?.candidate
assert.ok(chosen, 'missing synthetic scale fixture')

const samples = []
for (const count of [0, 1, 6, 100, 2000]) {
  const data = path.join(chosen, String(count))
  assert.ok((await fs.readdir(path.join(data, '_user'))).filter(name => name.endsWith('.md')).length === count)
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(plugin, { memoryDir: data, maxBytes: 4096, enableUserScope: true, autoSummarize: false, autoSummarizeMaxMemories: 5, autoSummarizeMaxTokens: 2048, minImportance: 4, staleAfterDays: 0 })
    const agent = { session: { id: 'scale-' + count, header: { cwd: path.join(chosen, 'synthetic-project') } } }
    const timings = []
    let expectedText
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      const assembled = await ctx.systemPrompt.assemble({ agent })
      timings.push(performance.now() - start)
      const text = assembled.sections.find(section => section.name === 'memory-wh:index')?.text ?? ''
      assert.ok(Buffer.byteLength(text) <= 4096)
      if (expectedText !== undefined) assert.equal(text, expectedText, 'unstable prompt text')
      expectedText = text
    }
    assert.equal(count === 0, expectedText === '', 'unexpected empty/nonempty prompt')
    const sorted = [...timings].sort((a, b) => a - b)
    samples.push({ count, firstMs: timings[0], p50Ms: sorted[2], maxMs: sorted[4], bytes: Buffer.byteLength(expectedText), timingsMs: timings })
  } finally { await ctx.fiber.dispose() }
}
const report = { status: 'passed', method: 'Real Cordis + SystemPrompt + WH plugin assemble() including async scan and audit enqueue; 5 sequential runs per fixture; 4096-byte budget.', fixture: path.relative(root, chosen), node: process.version, cpu: os.cpus()[0]?.model, samples, limitations: 'Synthetic local fixture; warm/cold filesystem cache mixed. No model, HTTP, browser, compression or child agent. Audit durability is not included in latency.' }
await fs.mkdir(path.join(root, 'docs/evidence/S05-async-scale'), { recursive: true })
await fs.writeFile(path.join(root, 'docs/evidence/S05-async-scale/assembly-scale.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
