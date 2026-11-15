# Upstream provenance

Project working name: dsh-auto-memory-WH. Current version: 1.0.0-rc.2 (2026-11-08), 2026-11-08 (Asia/Shanghai). The S01–S03 sections below are historical stage records, not the current release status.

- Source: https://github.com/AskTheWay/dsh-auto-memory
- Tag: v1.3.0
- Full commit: f2a266f2320e5cb346527073759dc1a3276281b2
- Remote: upstream; no personal remote created and nothing published.
- Source and existing copyright notices retained. LICENSE: MIT, Copyright (c) 2026 AskTheWay.
- LICENSE SHA-256: 673d033118b840f53afb053da5119cb42faae2ee268966087f7428c618e30fe4
- S01 baseline package-lock.json SHA-256: 032464a19ddf1caf40b6e3d1c6c0a27fce2f0ed0a06f86765b86dc37026807e3. S02 changes root package metadata and peer declarations, so this is not the current lockfile hash.
- Full upstream tree and history imported by tag checkout. S01 retained the original package identity and did not change functional source.
- S01 added verification scripts, documentation/evidence and the .work ignore rule. S02 changes are described below.

## Independent S02 changes

- Package dsh-auto-memory-wh, plugin/panel auto-memory-wh, API /api/auto-memory-wh, prompt section memory-wh:index, locale autoMemoryWH and CSS prefix dam-wh- distinguish this independent project.
- Default storage is the host-resolved memory-wh directory. No existing user memory was read, moved or migrated. Explicit memoryDir overrides do not provide migration protection.
- Added budget-key normalization, validation before store access and rejection of existing memory_* tool ownership when WH loads. Automatic summarization defaults to false.
- Core DSH peers explicitly list 0.1.5-rc.2 || 0.2.1-rc.5. Locked regression dependencies remain on the original baseline; actual Desktop core services are probed separately. This is not complete Desktop compatibility certification.
- Development package is private, version 0.1.0-dev.0. Automatic publication and the upstream release-backfill helper are disabled; their originals are archived.
- Original README.md, README.zh.md, CHANGELOG.md and CONTRIBUTING.md are preserved byte for byte in docs/upstream/. Original publish.yml and backfill-releases.mjs are archived there with inactive extensions. Root documents now describe WH.
- Added identity/configuration tests, verification scripts, configuration/decision documentation, a dependency license declaration inventory and stage reports in docs/progress/. Version history is root CHANGELOG.md.
- The core memory implementation is inherited. Safe migration, backup/restore, soft deletion and strict trust filtering are not completed by this stage. See the S02 progress report and compatibility matrix for remaining gates.

## Reproducibility

System build Node: 24.22.0. Dependencies: npm ci --ignore-scripts --no-audit --no-fund with a project-local cache. Build: npm run build. Tests: npm test -- --reporter=json --outputFile=docs/evidence/S01/upstream-tests.json.

S01: 202/202 tests passed using the locked dependencies (DSH core dependency baseline 0.1.5-rc.2). S02: clean installation, typecheck, build and 213/213 regression tests passed. The additional 11 tests cover WH configuration, isolated default storage and tool conflicts. These suites are distinct from the separate five-check Desktop 0.2.1-rc.5 core-service probe. Evidence lives in docs/evidence/S01 and docs/evidence/S02.

During S01, downloaded npm dsh-auto-memory@1.3.0 without lifecycle scripts. LICENSE, package.json, lib/index.js and lib/client.js matched the then-unmodified local fixed-tag build byte for byte. See docs/evidence/S01/package-comparison.json and upstream-package.json for hashes, integrity and file manifest. The independent S02 build intentionally differs; its local package manifest and smoke-check evidence are in docs/evidence/S02.

The lock inventory contains 150 dependency entries including platform-specific optional packages; npm installed 103 packages on this machine. Every lock entry has a declared license. This is a declaration inventory, not a completed legal or vulnerability review.

## Independent S03 changes

Added scope recovery journals, root writer coordination, explicit stale-lock maintenance, raw-byte deletion archives and pre-batch snapshots. Existing nonempty unmarked stores now require migration before writes. Project paths are bound to encoded scope directories to detect collisions. Unknown top-level frontmatter fields survive ordinary writes; migration and archiving retain exact record bytes. Optional expectedRevision rejects stale edits at the store boundary; full UI/API integration is pending.

Added an offline maintenance CLI for inventories, hashed migration plans, source rechecks, backup verification, byte-for-byte restore rehearsals, staged copy migration, fresh-directory restores and interrupted-operation recovery. It does not change DSH configuration. Added 25 tests, including actual child-process exit, concurrent writers, failure injection, junctions, recovery conflicts and interrupted migrations. Functional tests now allow durable I/O time and limit worker concurrency. No new dependency was added.

The package remains private and unpublished. S03 synthetic checks are distinct from complete G2/G3 acceptance; physical power loss, real authorized data copies, Windows ACL review, full UI/approval/installer flows and all-caller revision enforcement remain open. See docs/storage-recovery.md and the S03 stage report.

## Upstream sync policy

Keep tag/commit provenance and copyright. Compare future upstream commits, select changes deliberately, and rerun regression tests. Do not overwrite local development automatically. Do not describe inherited capabilities as original work.

## Current repository state

The checkout remains at the upstream tag (detached HEAD), with S01–S03 changes saved as uncommitted working files. Creating a development branch was denied in earlier stages by the environment's separately protected .git metadata rules, including after an explicit permission grant. No workaround replaced or relocated repository metadata. Resolve the environment restriction before committing; saved files and local build artifacts do not constitute a development commit. Nothing has been pushed or published.
