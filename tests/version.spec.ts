/**
 * Guards the single candidate-version source.
 *
 * 0.1.0-rc.9 shipped audit and snapshot records whose `pluginVersion` was
 * hardcoded to the previous candidate (`0.1.0-rc.8`). These assertions fail
 * whenever package.json and the identity constant drift apart, so a release
 * bump cannot silently leave generated records claiming an older version.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME, PLUGIN_VERSION } from '../src/identity.ts'

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  name: string
  version: string
}

describe('candidate version identity', () => {
  it('matches the package manifest version', () => {
    expect(PLUGIN_VERSION).toBe(manifest.version)
  })

  it('is a semver release or release-candidate string', () => {
    expect(PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/)
  })

  it('uses the same package name as the manifest', () => {
    expect(PACKAGE_NAME).toBe(manifest.name)
  })
})
