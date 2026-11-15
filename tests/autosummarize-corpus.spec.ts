/**
 * v0.2.0 autoSummarize 评估语料:用合成会话 + 候选批直接驱动 applyConsolidationCandidates，
 * 对真实 MemoryStore 断言去留与落盘状态。语料见 tests/fixtures/autosummarize/corpus.json。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/store.ts'
import { applyConsolidationCandidates, type RawCandidate } from '../src/consolidate.ts'

interface CorpusCase {
  id: string
  description: string
  options: { minImportance: number; enableUserScope: boolean; maxMemories: number; dedupe: boolean }
  seed: Array<{ name: string; description: string; type: string; body: string; status?: string; importance?: number }>
  transcript: string
  candidates: RawCandidate[]
  expect: {
    written: number
    created: string[]
    updated: string[]
    superseded: string[]
    duplicate: string[]
    chitchat: string[]
    lowImportance: string[]
    invalid: number
  }
}

const corpusPath = join(import.meta.dirname, 'fixtures', 'autosummarize', 'corpus.json')
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as { version: number; cases: CorpusCase[] }
const roots: string[] = []

function makeStore(): { store: MemoryStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'wh-autosummarize-'))
  roots.push(root)
  return { store: new MemoryStore(root), root }
}

const cwd = 'C:/synthetic/autosummarize-corpus-project'

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('autoSummarize evaluation corpus', () => {
  it('corpus is non-empty and versioned', () => {
    expect(corpus.version).toBe(1)
    expect(corpus.cases.length).toBeGreaterThanOrEqual(10)
    expect(new Set(corpus.cases.map(c => c.id)).size).toBe(corpus.cases.length)
  })

  for (const testCase of corpus.cases) {
    it(`${testCase.id}: ${testCase.description}`, async () => {
      const { store } = makeStore()
      for (const seed of testCase.seed) {
        await store.write({
          name: seed.name,
          description: seed.description,
          type: seed.type as never,
          body: seed.body,
          ...(seed.status !== undefined ? { status: seed.status as never } : {}),
          ...(seed.importance !== undefined ? { importance: seed.importance } : {}),
        }, 'project', cwd)
      }

      const tally = await applyConsolidationCandidates({
        store,
        cwd,
        candidates: testCase.candidates,
        options: {
          enableUserScope: testCase.options.enableUserScope,
          minImportance: testCase.options.minImportance,
          autoSummarizeMaxMemories: testCase.options.maxMemories,
          autoSummarizeDedupe: testCase.options.dedupe,
        },
        sessionId: 'synthetic-session',
        transcript: testCase.transcript,
      })

      expect(tally.written, 'written').toBe(testCase.expect.written)
      expect([...tally.created].sort(), 'created').toEqual([...testCase.expect.created].sort())
      expect([...tally.updated].sort(), 'updated').toEqual([...testCase.expect.updated].sort())
      expect([...tally.superseded].sort(), 'superseded').toEqual([...testCase.expect.superseded].sort())
      expect([...tally.duplicate].sort(), 'duplicate').toEqual([...testCase.expect.duplicate].sort())
      expect([...tally.chitchat].sort(), 'chitchat').toEqual([...testCase.expect.chitchat].sort())
      expect([...tally.lowImportance].sort(), 'lowImportance').toEqual([...testCase.expect.lowImportance].sort())
      expect(tally.invalid, 'invalid').toBe(testCase.expect.invalid)

      if (testCase.id === 'update-existing-by-name') {
        const record = await store.read('editor-theme', 'project', cwd)
        expect(record?.body).toContain('light editor theme')
        expect(record?.status).toBe('candidate')
      }
      if (testCase.id === 'supersede-with-new-date') {
        const old = await store.read('release-date', 'project', cwd)
        const next = await store.read('release-date-v2', 'project', cwd)
        expect(old?.status).toBe('superseded')
        expect(old?.supersededBy).toBe('release-date-v2')
        expect(next?.supersedes).toBe('release-date')
        expect(next?.body).toContain('2026-12-01')
      }
      if (testCase.id === 'user-scope-downgraded') {
        expect(await store.read('prefers-dark-mode', 'user', cwd)).toBeNull()
        expect((await store.read('prefers-dark-mode', 'project', cwd))?.scope).toBe('project')
      }
      if (testCase.id === 'fake-evidence-dropped') {
        expect((await store.read('user-timezone', 'user', cwd))?.evidence).toBeUndefined()
      }
      if (testCase.id === 'max-memories-cap') {
        expect(await store.read('pref-three', 'user', cwd)).toBeNull()
      }
    })
  }
})

describe('v0.6.0 quality gate: generic names', () => {
  it('drops generic-named candidates and keeps the specific one', async () => {
    const { store } = makeStore()
    const tally = await applyConsolidationCandidates({
      store,
      cwd,
      candidates: [
        { name: 'notes', description: '用户偏好深色主题。', type: 'user', body: '用户偏好深色主题，避免亮色界面。' },
        { name: 'editor-theme-2026', description: '用户偏好深色主题。', type: 'user', body: '用户偏好深色主题，避免亮色界面。' },
      ],
      options: { enableUserScope: true, minImportance: 0, autoSummarizeMaxMemories: 5, autoSummarizeDedupe: true },
      sessionId: 'synthetic-session',
      transcript: 'USER: 我更喜欢深色主题。',
    })
    expect(tally.lowQuality).toEqual(['notes'])
    expect(tally.created).toEqual(['editor-theme-2026'])
    expect(await store.read('notes', 'user', cwd)).toBeNull()
  })
})
