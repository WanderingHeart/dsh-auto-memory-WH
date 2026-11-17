# Upstream provenance

`dsh-auto-memory-WH` is an independently maintained derivative of AskTheWay/dsh-auto-memory.

- Upstream repository: https://github.com/AskTheWay/dsh-auto-memory
- Imported upstream tag: `v1.3.0`
- Imported upstream commit: `f2a266f2320e5cb346527073759dc1a3276281b2`
- Upstream license: MIT, Copyright (c) 2026 AskTheWay
- LICENSE SHA-256 at import: `673d033118b840f53afb053da5119cb42faae2ee268966087f7428c618e30fe4`

The current repository retains the imported commit as an ancestor of `main`; the upstream history was not squashed or replaced. The original license text and attribution remain in [LICENSE](LICENSE). Historical upstream documents and inactive publication helpers are retained under `docs/upstream/` where applicable.

## Independent identity and changes

The derivative uses package `dsh-auto-memory-wh`, plugin/panel ID `auto-memory-wh`, API base `/api/auto-memory-wh`, prompt section `memory-wh:index`, locale namespace `autoMemoryWH`, and default data directory `memory-wh`. Its later history adds WH-specific storage safety, migration/recovery tools, trust filtering, asynchronous prompt assembly, audit/management UI, reminders, backup, transfer/sync experiments, editions, topic and merge workflows, and two-level project/user memory.

The default WH root is intentionally separate from upstream's historical data location. Existing non-empty unmarked storage is not adopted automatically. An explicit `memoryDir` changes the target path but does not waive migration checks.

## Sync policy

Future upstream changes must be compared and selected deliberately. Keep the upstream tag/commit provenance and copyright, review any conflicting storage or identity assumptions, and rerun the complete regression and package checks. Do not describe inherited functionality as original WH work.

## Current release state

The current stable package is `dsh-auto-memory-wh@1.0.1`. This file records provenance, not a claim that every historical acceptance result still applies to later dependencies or host builds. Current validation belongs in `docs/release-readiness/` and the release-specific reports.
