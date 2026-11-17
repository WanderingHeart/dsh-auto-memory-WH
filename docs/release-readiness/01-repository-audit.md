# Repository audit

Date: 2026-11-17 (Asia/Shanghai)

Audited revision: `269b9be4f808308588c0e0dbd440d78e3b9919c7` (`v1.0.1`) plus the changes on `audit/release-readiness-dsh-market`

Scope: source, package metadata, build/test inputs, distribution contents, lifecycle, storage, privacy/security, compatibility, licensing, provenance, and current market prerequisites.

## Readiness conclusion

The repository is suitable for a review Draft PR after the changes in this branch. It is **not yet ready for an official catalog submission** because a native DSH Desktop acceptance run against the final commit has not been repeated, the required `dsh-plugin` GitHub topic could not be confirmed through the rate-limited unauthenticated API, and the current catalog has no entry for this repository. No publication or catalog submission was performed.

The review found no required architectural or storage-format change. The material fixes are documentation accuracy, reproducible package-manager metadata, a single `npm run check` entry point, a development-tool security patch, refreshed provenance, and a non-stale license inventory.

## Package and release configuration

| Area | Evidence | Result |
|---|---|---|
| Identity | `name=dsh-auto-memory-wh`, `version=1.0.1`, `private=false`, MIT, repository/homepage/bugs point to `WanderingHeart/dsh-auto-memory-WH` | Pass |
| Entrypoints | ESM `lib/index.js`, types `lib/index.d.ts`, browser bundle `lib/client.js`; exports include root, client, and package.json | Pass; no CommonJS host entry is claimed |
| Published files | `files` limits output to built artifacts, manifest patch, license/provenance/notices/changelog and three packaged docs; npm always includes README files | Pass; dry-run listed 15 files and no `.work`, tests, source maps, fixtures, credentials, or memory data |
| Scripts | `build`, `typecheck`, `test`, `prepare`; branch adds `check` as typecheck → tests → build | Pass |
| Package manager | lockfile v3; branch declares `npm@11.19.1` | Pass for the audited environment; older npm clients were not tested |
| Engines | Node `^22.19.0 || >=24.0.0`; DSH `>=0.2.1-rc.5 <1.0.0` | Declaration is internally consistent; not every allowed version was executed |
| Host peers | Cordis `>=4.0.2 <5`; eight DSH peers restricted to three known release-candidate sets | Conservative but brittle as DSH evolves; final Desktop build must be checked |
| Release automation | CI runs npm ci, typecheck, tests, build, and entry smoke on Windows and Ubuntu/Node 24. No active publish workflow was found | Safe: merge does not itself publish; actual npm/GitHub release remains manual |

The `prepare` script is necessary for Git-source installs and means those installs execute a build. The published npm package is prebuilt. pnpm is not required by this repository, although a DSH host/market may use its own package manager when installing plugins.

## Cordis patch and DSH manifest

`cordis.patch.yml` inserts exactly one bundle row:

```yaml
- insert:
    - id: auto-memory-wh
      name: dsh-auto-memory-wh
```

`package.json` declares `dsh.manifestVersion: 1`, points `dsh.bundle.patch` at that file, and declares the web client plus its locale/layout/sidebar injections. The manifest compatibility tests passed. The current catalog rules explicitly require `dsh.bundle`; this repository satisfies that structural requirement.

## Dependencies and licenses

Runtime dependencies are `@deepseek-ai/schemastery` and `yaml`; the resolved transitive runtime graph adds `@deepseek-ai/cosmokit` and `@standard-schema/spec`. The host supplies Cordis and DSH peers. None of these dependency directories is embedded in the tarball.

The first complete audit found four development-only advisories: Vitest/@vitest/mocker (moderate), Vite (high aggregate), and source-map-js (high). Updating Vitest to `^4.1.12` resolved those advisories. The newest transitive Rolldown 1.2.19 Windows binding failed to load in this environment, so the final metadata pins the fixed Vite 8.3.3 and compatible Rolldown 1.2.11 through npm overrides. A subsequent clean install, tests, and build passed. The repeated full and production audits both reported zero known vulnerabilities. This does not predict future advisory database changes.

The updated lock contains 160 entries and no missing declared license. Counts are MIT 139, MPL-2.0 12, ISC 4, Apache-2.0 3, BSD-2-Clause 1, and BSD-3-Clause 1. `THIRD_PARTY_NOTICES.md` now identifies the distributed runtime graph and uses `package-lock.json` as the detailed generated inventory instead of duplicating a stale table. This is an engineering review, not legal advice.

## Provenance and Git history

The clone contains 55 commits. Upstream commit `f2a266f2320e5cb346527073759dc1a3276281b2` is an ancestor of the current release tags `v1.0.0` and `v1.0.1`; the original AskTheWay commits and authors are present at the beginning of history. `LICENSE` remains the upstream MIT text and copyright. `UPSTREAM.md` now describes the actual committed release state instead of an obsolete detached/uncommitted development state.

## Lifecycle and failure behavior

Static review and tests show the following:

- Capability checks run before storage construction. Missing/renamed host capabilities register read-only diagnostics and leave memory files untouched.
- Configuration is normalized and validated before store access. Relative/empty `memoryDir`, conflicting budget aliases, and out-of-range values fail startup.
- Existing owners of any of the five core memory tools cause a visible startup error; WH does not silently replace them.
- Timers for automatic merge, automatic backup, and idle consolidation are registered through Cordis effects and cleared on disposal. Consolidation cancels idle timers, aborts active work, and waits for tracked tasks during teardown; audit output is flushed. Management fetch routes yield their disposer when the host supports effects.
- Session-scoped maps, audit buffers, and consolidation capture state are cleared on `session/disposed`.
- Auto-merge and auto-backup errors are logged and skipped instead of breaking the host. LLM failure, truncation, parse failure, or an absent route does not fabricate a memory or fail the conversation.
- Reapplying without proper host disposal is expected to collide with already registered tools/routes; correct repeated initialization therefore depends on Cordis disposing the prior plugin context. Synthetic lifecycle tests exist, but the final branch was not loaded/unloaded repeatedly in a native Desktop instance.

## Storage, migration, and user-data safety

The default root is host-resolved `DSH_HOME/memory-wh`. Project scopes map to encoded directories with a bound original cwd; user scope is `_user`. A format marker prevents accidental adoption of a non-empty unmarked directory.

Writes take a root lock and a scope lock, record a bounded transaction journal, update files using atomic replacement, flush changed file contents, mark the journal committed, and then remove it. Prepared operations roll back; committed operations retain the new state and finish cleanup. Reads fail closed while a writer/recovery journal is present. Path helpers reject roots at the filesystem root, traversal, links/junctions, Windows device names, alternate path syntax, control characters, and oversized/non-regular files.

Limits include 1 MiB reads per record, 512 KiB serialized write inputs, 4096 Markdown files and 32 MiB per scope transaction. Corrupt/unknown formats, malformed archives, hash mismatches, unexpected files in controlled maintenance flows, and failed rollback retain evidence and require review rather than guessing.

Deletion moves original bytes and metadata to `.archive`; it is not erasure. Bulk operations create snapshots. Restore targets a new directory and refuses overwrite. Cross-scope requests are not one atomic transaction. Automatic backup is a best-effort tree copy, not a writer-stopped offline snapshot. Uninstall does not delete data.

The 653-test suite covered child-process interruption, concurrent writers, stale locks, rollback/commit recovery, archive/restore, migrations and project collisions using synthetic temporary roots. This review deliberately did not access real user memory. Physical power loss, controller caches, malicious same-user directory races, Windows ACLs, and network filesystems remain outside the demonstrated guarantee.

## Privacy and security

- The plugin has no independent credential configuration. Model calls use the DSH route for session consolidation; model requests can therefore transmit session text and injected index content to the selected provider.
- Memory is explicitly framed as background data rather than instructions. Secret and injection-pattern filters are defensive heuristics, not comprehensive detection.
- Logs include errors, counts, outcomes, and sometimes memory names; normal consolidation logging does not print full candidate bodies. Stack traces in management failures can reveal local paths and should not be published without review.
- Audit files, journals, archives, backups, export files, device identity/trust files, and relay tokens are sensitive local artifacts. They are excluded from the npm tarball. Sync is operator-invoked and remains a feature requiring separate real two-device validation.
- Management routes use the host connection/fetch registration. This audit did not independently penetration-test host authentication or same-origin enforcement.
- No secrets were found by the final tracked-file pattern scan; this is not equivalent to dedicated secret-scanning service coverage.

## Compatibility conclusion

Executed here: Windows 11 host, Node 24.22.0, npm 11.19.1, locked baseline Cordis 4.0.2 and DSH peer packages 0.1.5-rc.2. Repository CI is configured for Windows and Ubuntu with Node 24, but this review did not wait for remote CI on the new branch.

Not established by this review: Node 22.19, macOS, Linux runtime behavior beyond existing CI configuration/history, DSH 0.2.1-rc.5, DSH 0.2.2-rc.3, future DSH versions below 1.0, native Desktop UI rendering, host authentication behavior, or a real configured model. Those require final-candidate testing in the intended Desktop build.

## Findings disposition

| Finding | Severity | Disposition |
|---|---:|---|
| Stale UPSTREAM current-state claims | Medium | Fixed |
| English README lacked full operational/privacy/removal guidance | Medium | Fixed |
| Chinese upgrade/removal/privacy boundaries were incomplete or mixed historical/current evidence | Medium | Fixed |
| Stale third-party inventory and versions | Medium | Fixed |
| Four development-tool advisories | Medium | Fixed by Vitest/Vite patches plus compatible Rolldown pin; clean install/check and audits passed |
| No single local check command / package-manager declaration | Low | Fixed |
| Final native Desktop lifecycle/UI acceptance not run | High release gate | Open; owner-run requirement |
| Current official catalog entry absent | High market gate | Open; submission intentionally not made |
| Required repository topic not confirmed | Medium market gate | Open; GitHub API rate-limited |
