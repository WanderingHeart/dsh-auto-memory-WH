import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'

describe('WH configuration compatibility', () => {
  it('normalizes defaults without hiding a legacy alias', () => {
    expect(plugin.normalizeConfig(plugin.Config({})).maxBytes).toBe(4096)
    expect(plugin.normalizeConfig(plugin.Config({ maxIndexBytes: 8192 })).maxBytes).toBe(8192)
    expect(plugin.normalizeConfig(plugin.Config({})).autoSummarize).toBe(true)
    expect(plugin.normalizeConfig(plugin.Config({})).enableUserScope).toBe(true)
    expect(plugin.normalizeConfig(plugin.Config({ autoSummarize: false })).autoSummarize).toBe(false)
    expect(plugin.normalizeConfig(plugin.Config({ enableUserScope: false })).enableUserScope).toBe(false)
    const config = plugin.normalizeConfig(plugin.Config({}))
    expect(config.autoSummarizeMinTurns).toBe(2)
    expect(config.autoSummarizeMinChars).toBe(600)
    expect(config.autoSummarizeDedupe).toBe(true)
    expect(config.notifyWhale).toBe('auto')
  })
  it('accepts only auto/off for the whale notification channel', () => {
    expect(plugin.normalizeConfig(plugin.Config({ notifyWhale: 'off' })).notifyWhale).toBe('off')
    expect(() => plugin.normalizeConfig(plugin.Config({ notifyWhale: 'sometimes' as never }))).toThrow()
  })
  it('defaults to the full edition and validates the edition name', () => {
    expect(plugin.normalizeConfig(plugin.Config({})).edition).toBe('full')
    expect(plugin.normalizeConfig(plugin.Config({ edition: 'minimal' })).edition).toBe('minimal')
    expect(() => plugin.normalizeConfig(plugin.Config({ edition: 'enterprise' as never }))).toThrow(/edition/)
  })
  it('accepts zero thresholds (gate disabled) and rejects out-of-range values', () => {
    expect(plugin.normalizeConfig(plugin.Config({ autoSummarizeMinTurns: 0, autoSummarizeMinChars: 0 })).autoSummarizeMinTurns).toBe(0)
    for (const value of [-1, 41, 1.5, Infinity]) {
      expect(() => plugin.normalizeConfig(plugin.Config({ autoSummarizeMinTurns: value }))).toThrow(/autoSummarizeMinTurns/)
    }
    for (const value of [-1, 24001, 1.5, Infinity]) {
      expect(() => plugin.normalizeConfig(plugin.Config({ autoSummarizeMinChars: value }))).toThrow(/autoSummarizeMinChars/)
    }
  })
  it('accepts equal keys and rejects disagreement', () => {
    expect(plugin.normalizeConfig(plugin.Config({ maxBytes: 8192, maxIndexBytes: 8192 })).maxBytes).toBe(8192)
    expect(() => plugin.normalizeConfig(plugin.Config({ maxBytes: 4096, maxIndexBytes: 8192 }))).toThrow(/disagree/)
  })
  it.each([-1, 65537, 4096.5, Infinity])('rejects unsafe or not-yet-supported budget %s', value => {
    expect(() => plugin.normalizeConfig(plugin.Config({ maxBytes: value }))).toThrow()
  })
  it.each(['', 'relative/data'])('rejects a non-explicit data location %s', memoryDir => {
    expect(() => plugin.normalizeConfig(plugin.Config({ memoryDir }))).toThrow(/absolute/)
  })
})

describe('WH separation from an existing memory installation', () => {
  let root: string | undefined
  let ctx: Context | undefined
  const previousDshHome = process.env.DSH_HOME

  afterEach(async () => {
    if (ctx) await ctx.fiber.dispose()
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    if (root) await fs.rm(root, { recursive: true, force: true })
    root = undefined
    ctx = undefined
  })

  it('writes to its own default root and preserves the old store', async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'wh-isolation-'))
    process.env.DSH_HOME = root
    const oldFile = join(root, 'memory', '_user', 'legacy.md')
    await fs.mkdir(join(root, 'memory', '_user'), { recursive: true })
    await fs.writeFile(oldFile, 'Original synthetic data; do not modify.')
    ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(plugin, plugin.Config({}))
    const tool = ctx.tools.get('memory_write')!
    await tool.execute({ name: 'wh-test', description: 'Synthetic', type: 'user', body: 'New synthetic data.', scope: 'user' }, { agent: { session: { header: { cwd: root }, id: 'wh-synthetic' } } } as never)
    expect(await fs.readFile(oldFile, 'utf8')).toBe('Original synthetic data; do not modify.')
    expect(await fs.readFile(join(root, 'memory-wh', '_user', 'wh-test.md'), 'utf8')).toContain('New synthetic data.')
    expect(await fs.readdir(join(root, 'memory', '_user'))).toEqual(['legacy.md'])
  })

  it('refuses duplicate tool ownership before accessing another root', async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'wh-conflict-'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(plugin, plugin.Config({ memoryDir: join(root, 'first') }))
    const second = join(root, 'must-not-be-created')
    expect(() => plugin.apply(ctx!, plugin.Config({ memoryDir: second }))).toThrow(/already owns/)
    await expect(fs.stat(second)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(ctx.tools.schemas().filter(t => t.name === 'memory_write')).toHaveLength(1)
  })
})

