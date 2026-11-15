import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { buildCompatReport, inspectCapabilities } from '../src/compat.ts'

function fakeContext(overrides: { tools?: unknown; systemPrompt?: unknown; connection?: unknown } = {}): Context {
  const services: Record<string, unknown> = {
    tools: overrides.tools ?? { register() {}, get: () => undefined },
    systemPrompt: overrides.systemPrompt ?? { section() {} },
    ...(overrides.connection === undefined ? {} : { connection: overrides.connection }),
  }
  return {
    get: (name: string) => services[name],
    on() {},
    effect() {},
    inject() {},
  } as unknown as Context
}

describe('host capability self-check', () => {
  it('accepts a host that exposes every used capability', () => {
    const issues = inspectCapabilities(fakeContext({
      connection: { fetch: { register() {} }, requestRejection() {} },
    }))
    expect(issues).toEqual([])
  })

  it('reports a renamed tools.register', () => {
    const issues = inspectCapabilities(fakeContext({ tools: { get: () => undefined } }))
    expect(issues.map(issue => issue.capability)).toContain('tools.register')
  })

  it('reports a missing systemPrompt.section', () => {
    const issues = inspectCapabilities(fakeContext({ systemPrompt: {} }))
    expect(issues.map(issue => issue.capability)).toContain('systemPrompt.section')
  })

  it('reports connection registration and authentication gaps when the web service exists', () => {
    const issues = inspectCapabilities(fakeContext({ connection: { fetch: {} } }))
    const capabilities = issues.map(issue => issue.capability)
    expect(capabilities).toContain('connection.fetch.register')
    expect(capabilities).toContain('connection.requestRejection')
  })

  it('does not require the optional web connection', () => {
    expect(inspectCapabilities(fakeContext())).toEqual([])
  })

  it('builds a report that tells the user data is untouched', () => {
    const report = buildCompatReport([{ capability: 'tools.register', detail: 'missing' }])
    expect(report.ok).toBe(false)
    expect(report.guidance).toContain('Memory files are untouched')
    expect(buildCompatReport([]).ok).toBe(true)
  })
})
