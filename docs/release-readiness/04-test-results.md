# Test results

Execution date: 2026-11-17 (Asia/Shanghai)

Environment: Windows, PowerShell, Node 24.22.0, npm 11.19.1

Data policy: only repository fixtures, Vitest temporary directories, and ignored `.work` cache/evidence paths were used. No real DSH memory store was read or modified.

## Executed checks

| Command | Outcome | Evidence / notes |
|---|---|---|
| `git clone https://github.com/WanderingHeart/dsh-auto-memory-WH.git repo` | Pass | Full clone; 55 commits; tags and upstream ancestor retained |
| `npm ci --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund` | Pass | Final updated lock: 113 packages added in about 2 minutes. The configured mirror and one local-cache attempt stalled during native extraction; primary registry plus normal cache completed |
| `npm run typecheck` | Pass | TypeScript exited 0 with no diagnostics |
| `npm run check` | Pass | Final toolchain: typecheck, 61 test files / 653 tests (20.24 s), then build; Rolldown 1.2.11 built all four artifacts |
| `npm audit --omit=dev --json` | Pass | 0 production advisories before the patch update |
| `npm audit --json` (initial) | Fail / finding | 4 development-tool advisories: 2 high and 2 moderate across Vitest/Vite/source-map-js |
| Vitest/Vite remediation and final clean install | Pass after one rejected attempt | Vitest 4.1.12 removed advisories. Rolldown 1.2.19 produced an invalid native binding here, so final overrides pin fixed Vite 8.3.3 and Rolldown 1.2.11; clean install/check passed |
| `npm audit --json --cache .work/npm-cache --registry=https://registry.npmjs.org` | Pass | 0 advisories in the full final graph; production-only audit also 0 |
| `npm pack --dry-run --json --ignore-scripts --cache .work/npm-cache` | Pass | Final: 15 files, 204,808 bytes packed / 695,233 unpacked; no bundled dependencies, source, tests, `.work`, memory data, or credentials |
| `npm ls --omit=dev --all` | Pass with expected optional notes | Host peers resolved from dev install; Cordis optional include/loader packages were absent and reported as unmet optional dependencies, not errors |
| Git ancestry checks | Pass | Upstream `f2a266f...` is an ancestor of HEAD and contained by release tags 1.0.0/1.0.1 |
| Authoritative market checks | Pass with open gates | Current market routes submissions to awesome-dsh-plugin; expected current entry returned 404; legacy issue #505 is closed |

## Automated test coverage observed

The passing suite included tests for configuration/manifest identity, prompt and injection budgeting, project/user scopes, consolidation gates and strategies, management client behavior, trust filters, storage transaction recovery, stale locks, multi-process contention, archive/restore, transfer/sync envelopes, reminders, topic/merge logic, audit behavior, compatibility diagnostics, and package version identity.

Tests use synthetic temporary roots. A passing synthetic suite does not prove native Desktop rendering, provider behavior, real user-data migration, or physical disk semantics.

## Static/code-review checks

These were reviewed rather than executed end-to-end:

- Cordis effect teardown for merge/backup/consolidation timers, active tasks, route disposal, session state, and audit flush;
- fail-before-storage behavior for capability and configuration errors;
- path, link/junction, file-size, transaction-size, hash, and format checks;
- prompt/model/logging data flow and the heuristic nature of secret/instruction filters;
- archive deletion versus secure erasure;
- package exports/files/engines/peer assumptions and the absence of an active publish workflow;
- upstream copyright, exact commit provenance, and retained Git ancestry;
- current market contribution text and expected catalog path.

## Checks not executed in this review

- native DSH Desktop install, startup, shutdown, reload, or repeated enable/disable on the final branch;
- browser UI interaction, management-route authentication penetration testing, optional whale hook, or native notification delivery;
- DSH 0.2.1-rc.5 and 0.2.2-rc.3 peer sets, Node 22.19, macOS, or a live Linux runtime;
- real model calls and provider-specific privacy/retention behavior;
- real user memory, authorized migration, backup restore of real data, or uninstall against a daily profile;
- real two-device relay, long-duration reminders, mobile use, physical power loss, a real full disk, Windows ACL matrix, or network filesystems;
- remote CI for the final pushed branch (branch was not yet pushed when this report was drafted).

## Final rerun requirement

The final working tree passed the locked clean install, `npm run check`, both npm audits, and `npm pack --dry-run`. Native Desktop acceptance remains a separate owner-run gate even though all feasible local commands passed.
