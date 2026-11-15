/**
 * Guards the declared DSH compatibility window.
 *
 * DSH skips an entire profile bundle when the plugin's `engines.dsh` range
 * does not match the runtime (see @deepseek-ai/dsh-app-boot). A too-narrow
 * range is exactly how 0.1.0 disappeared from the sidebar after the host
 * auto-updated from 0.2.1-rc.5 to 0.2.2-rc.1, so the range is now a reviewed
 * compatibility policy rather than an incidental field.
 *
 * The assertion below is deliberately implemented without the `semver`
 * package: this test must keep working in a bare checkout. It understands the
 * single `>=X <Y` form used by package.json and compares prerelease suffixes
 * the same way semver does for these versions.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  engines?: { dsh?: string }
}

interface Parsed {
  major: number
  minor: number
  patch: number
  prerelease: Array<string | number>
}

function parseVersion(input: string): Parsed {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input)
  if (!match) throw new Error(`unparseable version: ${input}`)
  const prerelease = match[4]
    ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : []
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease }
}

function compare(a: Parsed, b: Parsed): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

function satisfies(version: string, range: string): boolean {
  const match = /^>=(\S+)\s+<(\S+)$/.exec(range.trim())
  if (!match) throw new Error(`unexpected engines.dsh range: ${range}`)
  const candidate = parseVersion(version)
  return compare(candidate, parseVersion(match[1])) >= 0 && compare(candidate, parseVersion(match[2])) < 0
}

describe('declared DSH compatibility window', () => {
  const range = manifest.engines?.dsh

  it('declares an engines.dsh range', () => {
    expect(typeof range).toBe('string')
    expect(range).toMatch(/^>=0\.2\.1-rc\.5 <\d+\.\d+\.\d+$/)
  })

  it('keeps every host version that has been exercised locally', () => {
    expect(satisfies('0.2.1-rc.5', range!)).toBe(true)
    expect(satisfies('0.2.2-rc.1', range!)).toBe(true)
  })

  it('does not claim future major compatibility', () => {
    expect(satisfies('1.0.0', range!)).toBe(false)
    expect(satisfies('1.1.0-rc.1', range!)).toBe(false)
  })

  it('still rejects host versions older than the tested floor', () => {
    expect(satisfies('0.1.5-rc.2', range!)).toBe(false)
  })
})
