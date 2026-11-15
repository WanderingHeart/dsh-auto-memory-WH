import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { autoBackupState, runAutoBackup } from '../src/auto-backup.ts'

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wh-auto-backup-'))
  mkdirSync(join(dir, '_user'), { recursive: true })
  writeFileSync(join(dir, '_user', 'alpha.md'), 'body')
  writeFileSync(join(dir, 'audit.jsonl'), '{}\n')
  writeFileSync(join(dir, '_user', 'note.tmp'), 'partial')
  writeFileSync(join(dir, '_user', '.wh-writer.lock'), '1')
  return dir
}

describe('automatic backup', () => {
  it('is due when no backup exists and not due right after one', async () => {
    const dir = root()
    const settings = { intervalHours: 24, keep: 5 }
    expect((await autoBackupState(dir, settings)).due).toBe(true)
    await runAutoBackup(dir, settings, 'test')
    const state = await autoBackupState(dir, settings)
    expect(state.due).toBe(false)
    expect(state.last?.files).toBe(2)
    expect(state.last?.bytes).toBe(7)
  })

  it('copies files, skips temporary and lock files, and excludes previous backups', async () => {
    const dir = root()
    const entry = await runAutoBackup(dir, { intervalHours: 24, keep: 5 }, 'test')
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(entry.dir, 'manifest.json'), 'utf8')) as { files: Array<{ path: string }> }
    expect(manifest.files.map(file => file.path).sort()).toEqual(['_user/alpha.md', 'audit.jsonl'])
  })

  it('prunes the oldest backups beyond the keep count', async () => {
    const dir = root()
    const settings = { intervalHours: 1, keep: 2 }
    await runAutoBackup(dir, settings, 'test', new Date('2026-01-01T00:00:00Z'))
    await runAutoBackup(dir, settings, 'test', new Date('2026-01-02T00:00:00Z'))
    await runAutoBackup(dir, settings, 'test', new Date('2026-01-03T00:00:00Z'))
    const state = await autoBackupState(dir, settings)
    expect(state.existing).toHaveLength(2)
    expect(state.existing[0]!.createdAt).toBe('2026-01-03T00:00:00.000Z')
  })
})
