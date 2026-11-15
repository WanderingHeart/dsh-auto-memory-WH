import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/store.ts'
import { renderMemoryIndexDetail } from '../src/prompt.ts'
import { memoryScore } from '../src/store.ts'
import type { Config } from '../src/index.ts'

const cwd = 'D:\\synthetic-recall'
const config = { maxBytes: 4096, enableUserScope: true, staleAfterDays: 0 } as Config
const day = 86_400_000

describe('cross-session recall ordering', () => {
  it('prefers pinned, then recency-weighted importance, then project relevance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-recall-'))
    try {
      const store = new MemoryStore(root)
      const now = Date.now()
      await store.write({ name: 'old-feedback', description: 'stale preference', body: 'b', type: 'feedback', status: 'verified', lastReadMs: now - 120 * day } as never, 'user', cwd)
      await store.write({ name: 'fresh-project', description: 'current work', body: 'b', type: 'project', status: 'verified', lastReadMs: now } as never, 'project', cwd)
      await store.write({ name: 'pinned-ref', description: 'anchor', body: 'b', type: 'reference', status: 'verified', pinned: true, lastReadMs: now - 300 * day } as never, 'user', cwd)

      const detail = renderMemoryIndexDetail(store, config, cwd)
      expect(detail.injected).toEqual(['pinned-ref', 'fresh-project', 'old-feedback'])
      expect(detail.records.map(record => record.id)).toHaveLength(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ranks a project record ahead of a user record at the same score', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-recall-tie-'))
    try {
      const store = new MemoryStore(root)
      const now = Date.now()
      await store.write({ name: 'aaa-user', description: 'global note', body: 'b', type: 'project', status: 'verified', lastReadMs: now } as never, 'user', cwd)
      await store.write({ name: 'zzz-project', description: 'project note', body: 'b', type: 'project', status: 'verified', lastReadMs: now } as never, 'project', cwd)

      expect(memoryScore((await store.read('aaa-user', 'user', cwd))!, now)).toBeCloseTo(memoryScore((await store.read('zzz-project', 'project', cwd))!, now), 5)
      const detail = renderMemoryIndexDetail(store, config, cwd)
      expect(detail.injected).toEqual(['zzz-project', 'aaa-user'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses last read as the recency anchor instead of the write time', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-recall-anchor-'))
    try {
      const store = new MemoryStore(root)
      const now = Date.now()
      await store.write({ name: 'recently-read', description: 'r', body: 'b', type: 'reference', status: 'verified', lastReadMs: now } as never, 'user', cwd)
      await store.write({ name: 'never-read', description: 'n', body: 'b', type: 'reference', status: 'verified', lastReadMs: now - 90 * day } as never, 'user', cwd)

      const detail = renderMemoryIndexDetail(store, config, cwd)
      expect(detail.injected).toEqual(['recently-read', 'never-read'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
