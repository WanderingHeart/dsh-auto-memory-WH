import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { effectiveProjectCwd } from '../src/project-context.ts'

const parent = resolve('synthetic/parent')
const child = resolve('synthetic/child')
const original = { header: { cwd: parent } }
const context = (workingDirectory?: unknown): Context => ({ get: () => workingDirectory } as unknown as Context)

describe('effective project directory boundary', () => {
  it('uses the host current directory after a child changes workspace', () => {
    expect(effectiveProjectCwd(context({ get: () => child }), original)).toBe(child)
  })

  it('denies scope when a mounted directory service is invalid', () => {
    expect(effectiveProjectCwd(context({ get: () => '../relative' }), original)).toBeUndefined()
    expect(effectiveProjectCwd(context({ get: () => { throw new Error('unavailable') } }), original)).toBeUndefined()
  })

  it('uses the original absolute directory only without a directory service', () => {
    expect(effectiveProjectCwd(context(), original)).toBe(parent)
    expect(effectiveProjectCwd(context(), { header: { cwd: 'relative' } })).toBeUndefined()
  })
})
