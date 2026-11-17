# Documentation changes

Date: 2026-11-17 (Asia/Shanghai)

## Purpose

This branch makes user-facing claims match the current 1.0.1 code and separates current execution evidence from historical release reports. It does not claim that old acceptance results were rerun.

## Changed files

### `README.md`

Rewritten as the complete English entry document. It now covers:

- actual project/user scope behavior and the four independent content types;
- declared DSH, Node, and host-peer compatibility with an explicit “not every combination tested” boundary;
- Desktop/plugin-manager and isolated embedded-CLI installation guidance;
- source-install build-script behavior;
- current defaults and edition behavior;
- the model-call boundary and token implications;
- local files, provider transmission, heuristic secret/instruction filtering, and sensitive logs;
- locking, journaling, corruption fail-closed behavior, and unverified filesystem/platform limits;
- offline backup versus best-effort automatic backup;
- restore-to-new-directory behavior and the fact that rollback does not roll back data;
- uninstall versus separate data removal, including archive/backup/export/sync/provider copies;
- concrete troubleshooting for startup conflicts, recovery locks, unmarked stores, missing summaries, and optional whale notifications;
- the exact current review boundary: 653 synthetic tests, no native Desktop/UI or real-model rerun.

### `README.zh.md`

Added matching Chinese sections for data/privacy/security, uninstall/data removal, troubleshooting, and evidence boundaries. Replaced the broad upgrade claim with the safer operator sequence implemented by the maintenance tooling. Historical real-model evidence is now identified as historical rather than silently treated as a current rerun.

### `docs/configuration.md`

Updated the displayed version to 1.0.1 and clarified that an explicit absolute `memoryDir` is a supported controlled location but does not authorize migration. Defaults and ranges were checked against `src/index.ts`.

### `docs/storage-recovery.md`

Updated the document boundary from an isolated S03 development snapshot to the current 1.0.1 implementation while retaining the origin of historical tests. Corrected stale statements about UI/API revision integration and distinguished current automated coverage from the owner-only checks not rerun on 2026-11-17.

### `docs/trust-ui.md`

Updated the displayed version from rc.17 to 1.0.1. No behavior claim was expanded.

### `UPSTREAM.md`

Replaced obsolete claims that the repository was a detached, uncommitted development checkout. The file now records the exact upstream tag and commit, retained ancestor history, original MIT attribution, independent identity, sync policy, and the current stable release.

### `THIRD_PARTY_NOTICES.md`

Replaced the stale rc.2/160-entry inventory. The notice now identifies the four resolved runtime packages, their locked versions and license hashes; states that host peers are supplied by DSH; summarizes all 167 lock entries by license; and points to the lockfile as the detailed source of truth so the table does not drift again.

### `docs/release-readiness/`

Added exactly five independent reports requested for this review:

1. repository audit;
2. documentation changes;
3. market submission evidence;
4. executed test results;
5. next steps.

## Claims deliberately not made

The updated documentation does not claim:

- that every DSH version allowed by `engines.dsh` was executed;
- that Node 22, macOS, Linux runtime, or every Desktop build was tested in this review;
- that local storage prevents model-provider transmission;
- that secret/prompt-injection filters are complete;
- that archival deletion is secure erasure;
- that automatic backup is a consistent offline snapshot;
- that physical power loss, Windows ACLs, network filesystems, or malicious same-user races are solved;
- that the official catalog already lists this plugin;
- that real two-device sync, long-lived reminders, mobile use, a real model, or native Desktop UI was rerun.

## Review method

Documentation statements were checked against `package.json`, `cordis.patch.yml`, the build configuration, `src/index.ts`, `src/store.ts`, `src/storage-safety.ts`, consolidation/injection/audit/management code, the automated tests, the actual `npm pack --dry-run` manifest, and current authoritative market repositories. Historical reports were used only to identify context and were not treated as current execution proof.
