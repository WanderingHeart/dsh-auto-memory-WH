import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const stage = process.argv[2] ?? 'S05-edition-matrix'

const { EDITIONS, EDITION_PROFILES, editionFeatures, editionProfile } = await import(
  pathToFileURL(join(repo, 'src/editions.ts')).href
)
const { loadSettings, readEditionOverride, saveEditionOverride, saveSettings, settingsPath } = await import(
  pathToFileURL(join(repo, 'src/settings.ts')).href
)

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

check('three-editions', EDITIONS.length === 3 && EDITIONS.join(',') === 'minimal,standard,full', EDITIONS.join(','))

const minimal = EDITION_PROFILES.minimal
const standard = EDITION_PROFILES.standard
const full = EDITION_PROFILES.full

check('minimal-budget', minimal.maxBytes === 2048 && minimal.auditMaxBytes === 262144, `${minimal.maxBytes}/${minimal.auditMaxBytes}`)
check('standard-budget', standard.maxBytes === 4096 && standard.auditMaxBytes === 1048576, `${standard.maxBytes}/${standard.auditMaxBytes}`)
check('full-budget', full.maxBytes === 4096 && full.auditMaxBytes === 1048576, `${full.maxBytes}/${full.auditMaxBytes}`)
check('minimal-features-off', Object.values(minimal.features).every(value => value === false), 'all false')
check(
  'standard-matrix',
  Object.entries(standard.features)
    .filter(([key]) => key === 'graph' || key === 'batch')
    .every(([, value]) => value === false) &&
    Object.entries(standard.features)
      .filter(([key]) => key !== 'graph' && key !== 'batch')
      .every(([, value]) => value === true),
  'graph/batch off, rest on',
)
check('full-features-on', Object.values(full.features).every(value => value === true), 'all true')
check('labels-present', [minimal, standard, full].every(profile => profile.label.length > 0), [minimal.label, standard.label, full.label].join(' / '))

const isolated = editionFeatures('minimal')
isolated.graph = true
check('features-copy', editionFeatures('minimal').graph === false, 'mutating one copy does not leak')
check('profile-lookup', editionProfile('standard').edition === 'standard')

const root = mkdtempSync(join(tmpdir(), 'wh-edition-'))
try {
  check('settings-default-absent', readEditionOverride(root) === undefined)
  saveEditionOverride(root, 'minimal')
  check('settings-roundtrip', readEditionOverride(root) === 'minimal')
  const raw = JSON.parse(readFileSync(settingsPath(root), 'utf8'))
  check('settings-shape', raw.version === 1 && raw.edition === 'minimal', JSON.stringify(raw))
  saveSettings(root, { edition: 'full' })
  check('settings-patch-keeps-version', loadSettings(root).edition === 'full' && loadSettings(root).version === 1)
  writeFileSync(settingsPath(root), '{not json')
  check('settings-bad-file', readEditionOverride(root) === undefined && loadSettings(root).version === 1)
  writeFileSync(settingsPath(root), JSON.stringify({ version: 1, edition: 'bogus' }))
  check('settings-bad-edition', readEditionOverride(root) === undefined)
} finally {
  rmSync(root, { recursive: true, force: true })
}

const evidenceDir = join(repo, 'docs', 'evidence', stage)
mkdirSync(evidenceDir, { recursive: true })
const result = {
  stage,
  kind: 'edition-matrix',
  pass: checks.every(item => item.ok),
  at: new Date().toISOString(),
  checks,
  matrix: EDITIONS.map(edition => {
    const profile = EDITION_PROFILES[edition]
    return { edition, label: profile.label, maxBytes: profile.maxBytes, auditMaxBytes: profile.auditMaxBytes, features: profile.features }
  }),
  boundary: [
    'Static profile/feature contract plus settings round-trip; the API 403 gating is covered by tests/editions.spec.ts.',
    'No host process is started here; the 21-step host probes run separately.',
  ],
}
writeFileSync(join(evidenceDir, 'edition-matrix.json'), JSON.stringify(result, null, 2) + '\n')
console.log(`\n${result.pass ? 'PASS' : 'FAIL'} edition matrix — evidence ${join(evidenceDir, 'edition-matrix.json')}`)
if (!result.pass) process.exitCode = 1
