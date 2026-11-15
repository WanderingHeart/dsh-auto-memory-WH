import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveProject, listProjects, mergeProjects, remapProject } from '../src/projects.ts'
import { projectKey } from '../src/store.ts'

function projectDir(root: string, cwd: string): string {
  const dir = join(root, projectKey(cwd))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.wh-project.json'), JSON.stringify({ version: 1, cwd }))
  return dir
}

describe('project inventory', () => {
  it('lists project scopes without reading bodies and skips non-projects', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-projects-'))
    try {
      const alpha = projectDir(root, 'C:/work/alpha')
      writeFileSync(join(alpha, 'alpha-one.md'), 'one')
      writeFileSync(join(alpha, 'alpha-two.md'), 'two')
      writeFileSync(join(alpha, 'MEMORY.md'), 'index')

      const beta = projectDir(root, 'C:/work/beta')
      writeFileSync(join(beta, 'beta-one.md'), 'one')

      mkdirSync(join(root, '_user'), { recursive: true })
      writeFileSync(join(root, '_user', 'MEMORY.md'), '')
      mkdirSync(join(root, 'not-a-project'), { recursive: true })
      mkdirSync(join(root, 'broken'), { recursive: true })
      writeFileSync(join(root, 'broken', '.wh-project.json'), '{')

      const result = listProjects(root)
      expect(result.projects).toHaveLength(2)
      const byCwd = new Map(result.projects.map(project => [project.cwd, project]))
      expect(byCwd.get('C:/work/alpha')?.records).toBe(2)
      expect(byCwd.get('C:/work/beta')?.records).toBe(1)
      expect(result.skipped.map(entry => entry.directory)).toContain('broken')
      expect(result.skipped.map(entry => entry.directory)).not.toContain('not-a-project')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns an empty inventory for a missing root', () => {
    const root = join(tmpdir(), 'wh-projects-missing', String(Date.now()))
    expect(listProjects(root)).toEqual({ root, projects: [], skipped: [] })
  })
})

describe('project remap', () => {
  it('renames the scope directory and rewrites the mapping without touching records', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-remap-'))
    try {
      const source = projectDir(root, 'C:/work/alpha')
      writeFileSync(join(source, 'alpha-one.md'), 'one')
      writeFileSync(join(source, 'alpha-two.md'), 'two')

      const result = remapProject({ root, fromCwd: 'C:/work/alpha', toCwd: 'C:/work/renamed', writersStopped: true })
      expect(result.records).toBe(2)
      expect(result.fromCwd).toBe('C:/work/alpha')

      const target = join(root, projectKey('C:/work/renamed'))
      expect(readFileSync(join(target, 'alpha-one.md'), 'utf8')).toBe('one')
      const marker = JSON.parse(readFileSync(join(target, '.wh-project.json'), 'utf8'))
      expect(marker).toEqual({ version: 1, cwd: 'C:/work/renamed' })
      const inventory = listProjects(root)
      expect(inventory.projects.map(project => project.cwd)).toEqual(['C:/work/renamed'])
      expect(inventory.projects[0]?.records).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires writers to be stopped and refuses collisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-remap-guard-'))
    try {
      projectDir(root, 'C:/work/alpha')
      expect(() => remapProject({ root, fromCwd: 'C:/work/alpha', toCwd: 'C:/work/beta', writersStopped: false })).toThrow('Stop writers')
      expect(() => remapProject({ root, fromCwd: 'C:/work/alpha', toCwd: 'C:/work/alpha', writersStopped: true })).toThrow('already mapped')
      projectDir(root, 'C:/work/beta')
      expect(() => remapProject({ root, fromCwd: 'C:/work/alpha', toCwd: 'C:/work/beta', writersStopped: true })).toThrow('collision')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('project merge', () => {
  it('moves every record into the target scope and removes the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-merge-'))
    try {
      const alpha = projectDir(root, 'C:/work/alpha')
      const beta = projectDir(root, 'C:/work/beta')
      writeFileSync(join(alpha, 'alpha-one.md'), 'one')
      writeFileSync(join(alpha, 'alpha-two.md'), 'two')
      writeFileSync(join(beta, 'beta-one.md'), 'beta')

      const result = mergeProjects({ root, fromCwd: 'C:/work/alpha', intoCwd: 'C:/work/beta', writersStopped: true })
      expect(result.copied).toBe(2)
      expect(result.removedSource).toBe(true)
      const target = join(root, projectKey('C:/work/beta'))
      expect(readFileSync(join(target, 'alpha-one.md'), 'utf8')).toBe('one')
      expect(readFileSync(join(target, 'beta-one.md'), 'utf8')).toBe('beta')
      expect(existsSync(join(root, projectKey('C:/work/alpha')))).toBe(false)
      expect(listProjects(root).projects.map(project => project.records)).toEqual([3])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a differing collision, keeps the source, and can skip identical duplicates', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-merge-collision-'))
    try {
      const alpha = projectDir(root, 'C:/work/alpha')
      const beta = projectDir(root, 'C:/work/beta')
      writeFileSync(join(alpha, 'same.md'), 'alpha-version')
      writeFileSync(join(alpha, 'unique.md'), 'unique')
      writeFileSync(join(beta, 'same.md'), 'beta-version')

      expect(() => mergeProjects({ root, fromCwd: 'C:/work/alpha', intoCwd: 'C:/work/beta', writersStopped: true })).toThrow('collision')
      expect(existsSync(join(root, projectKey('C:/work/alpha'), 'unique.md'))).toBe(true)

      writeFileSync(join(beta, 'same.md'), 'alpha-version')
      const result = mergeProjects({ root, fromCwd: 'C:/work/alpha', intoCwd: 'C:/work/beta', writersStopped: true, skipIdentical: true })
      expect(result.skippedIdentical).toBe(1)
      expect(result.copied).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses to merge a scope into itself or without stopping writers', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-merge-guard-'))
    try {
      projectDir(root, 'C:/work/alpha')
      expect(() => mergeProjects({ root, fromCwd: 'C:/work/alpha', intoCwd: 'C:/work/alpha', writersStopped: true })).toThrow('itself')
      expect(() => mergeProjects({ root, fromCwd: 'C:/work/alpha', intoCwd: 'C:/work/alpha', writersStopped: false })).toThrow('Stop writers')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('project archive', () => {
  it('moves a scope under _archive/projects and hides it from the inventory', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-archive-'))
    try {
      const alpha = projectDir(root, 'C:/work/alpha')
      writeFileSync(join(alpha, 'alpha-one.md'), 'one')

      const result = archiveProject({ root, fromCwd: 'C:/work/alpha', writersStopped: true })
      expect(result.records).toBe(1)
      expect(existsSync(join(root, projectKey('C:/work/alpha')))).toBe(false)
      expect(existsSync(join(root, '_archive', 'projects', result.archiveDirectory, 'alpha-one.md'))).toBe(true)
      expect(listProjects(root).projects).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires writers to be stopped before archiving', () => {
    const root = mkdtempSync(join(tmpdir(), 'wh-archive-guard-'))
    try {
      projectDir(root, 'C:/work/alpha')
      expect(() => archiveProject({ root, fromCwd: 'C:/work/alpha', writersStopped: false })).toThrow('Stop writers')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
