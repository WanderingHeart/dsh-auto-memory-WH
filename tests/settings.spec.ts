import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSettings, readEditionOverride, saveEditionOverride, saveSettings, settingsPath } from '../src/settings.ts'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wh-settings-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('plugin settings (v0.12.1)', () => {
  it('returns defaults when nothing has been saved', () => {
    expect(loadSettings(root)).toEqual({ version: 1 })
    expect(readEditionOverride(root)).toBeUndefined()
  })

  it('round-trips the edition override in settings.json', async () => {
    saveEditionOverride(root, 'minimal')
    expect(JSON.parse(await fs.readFile(settingsPath(root), 'utf8'))).toEqual({ version: 1, edition: 'minimal' })
    expect(readEditionOverride(root)).toBe('minimal')
    saveEditionOverride(root, 'standard')
    expect(readEditionOverride(root)).toBe('standard')
  })

  it('ignores invalid editions and corrupt files instead of crashing', async () => {
    saveSettings(root, { edition: 'full' })
    await fs.writeFile(settingsPath(root), '{broken', 'utf8')
    expect(loadSettings(root)).toEqual({ version: 1 })
    await fs.writeFile(settingsPath(root), JSON.stringify({ version: 1, edition: 'enterprise' }), 'utf8')
    expect(loadSettings(root)).toEqual({ version: 1 })
  })
})
