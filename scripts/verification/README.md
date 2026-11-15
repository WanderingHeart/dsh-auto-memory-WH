# Verification entry points

Every check is read-only with respect to daily DSH profiles and the user's real memory; synthetic data is written under `.work/S05/` and evidence lands in `docs/evidence/`.

## One-command acceptance for a candidate

```powershell
# Candidate metadata, packaging and audits only
& 'C:\Program Files\nodejs\node.exe' scripts/verification/acceptance-suite.mjs 0.1.0-rc.11

# Add the packaged-host probes (requires the candidate to be installed in wh-s05)
& 'C:\Program Files\nodejs\node.exe' scripts/verification/acceptance-suite.mjs 0.1.0-rc.11 --with-host
```

Steps: `typecheck` → `build` → `unit` → `pack` → `package-smoke` → `distribution` → `license`; with `--with-host` it also runs the audit-bridge lifecycle probe, the policy matrix, the installed session lifecycle, the peer topology and the host dependency inventory. The summary is written to `docs/evidence/S05-rcN-acceptance/summary.json`; the exit code is non-zero if any step fails. `--skip-build` skips the rebuild step.

Prerequisites:

- Node 24 (for `.ts` type stripping) and `npm` next to it.
- To install/remove the candidate in the isolated profile, run `scripts/verification/isolated-cli.ps1` (see the comments in that file). Acceptance does not install anything.
- Host probes must run with `ELECTRON_RUN_AS_NODE=1` and the Desktop executable, because the packaged DSH host lives inside `app.asar`. `acceptance-suite.mjs` sets this up itself.

## Individual probes

| Script | Purpose |
| --- | --- |
| `host-audit-bridge-probe.cjs` | Prompt assembly, review/mute exclusion, audit JSONL and project API on the packaged host. Use `--installed-version 0.1.0-rc.N` (plus `--lifecycle` / `--policy-matrix`). |
| `installed-active-session-lifecycle.cjs` | Session revocation/remapping through the packaged host HTTP API. |
| `installed-peer-topology.cjs` | Resolves the eight peer packages from the installed bundle and the host. |
| `host-dependency-inventory.cjs` | Reads the packaged host's dependency versions (zod/cordis). Requires Electron Node. |
| `storage-acl-matrix.mjs` | Six Windows ACL scenarios with ACL restore verification. |
| `storage-sustained-load.mjs`, `storage-lock-timeout-recovery.mjs` | Multi-process contention and stale-lock recovery. |
| `storage-stale-lock-pid-reuse.mjs` | Injects foreign writer locks (live PID, dead PID, non-PID content) at the root and scope lock levels; asserts fail-closed timeouts, untouched records, preserved locks, and successful writes after an operator removes the lock. |
| `upgrade-failure-drill.mjs` | Offline drill on a copied installation home: truncated-tarball install attempts, remove, reinstall and a second failing attempt; asserts the memory directory is byte-identical and the installed version stays intact after every step. |
| `upgrade-fault-recovery.mjs` | Real version-to-version upgrade drill on a copied home (rc.10 → rc.11): kills the install process mid-flight, then removes the installed bundle to simulate a half-upgrade; asserts memory stays byte-identical, the same `add` repairs it, and the packaged host lifecycle probe loads the upgraded bundle. Sets `DSH_HOME` to the copy so the real home is never touched. |
| `scale-matrix.mjs` | Assembly/list/read/write at 100–5000 records, including the scope limit. |
| `snapshot-restore-matrix.mjs` | Backup/verify/restore round-trip, seven corrupted-snapshot rejections, archive restore and maintenance unlock branches on synthetic roots. |
| `audit-resilience-matrix.mjs` | Audit rotation/retention, corrupt-line repair, oversized event/file fail-closed, queue-full drops, missing/garbage files. |
| `path-unicode-matrix.mjs` | Canonical-name enforcement, traversal-shaped input, Unicode round-trip, foreign/device-name files fail-closed, index budget and trust-reason exclusions. |
| `autosummarize-eval.mjs` | Runs the synthetic autoSummarize corpus through vitest and writes case-level evidence to `docs/evidence/S05-v020-autosummarize/eval.json`; asserts the threshold gate, create-branch dedupe, churn/importance/scope/evidence filtering and the maxMemories cap without a live model call. |
| `host-compat-check.mjs` | Read-only DSH compatibility probe: reads the repository `engines.dsh` window, the packaged host version (Electron runtime), the profile bundle list and the installed plugin manifest, then predicts the app-boot decision (with `includePrerelease` semver) and suggests reinstall/exemption. Evidence: `docs/evidence/<stage>/host-compat.json`. |
| `manual/disk-full-drill.ps1`, `manual/disk-full-write.mjs` | Owner-run disk-full drill on a dedicated small VHD/USB: fills the volume, asserts the save fails without touching records, frees space, recovers and verifies. Dry run with `-SkipFill -AllowAnyDrive -WorkDir <dir>`. Steps in `docs/progress/2026-11-05_002_需要你亲自参与的隔离测试（rc.11_候选）.md`. |
| `manual/power-loss-write.mjs`, `manual/power-loss-verify.mjs` | Owner-run power-loss drill inside a Windows VM: the writer seeds five baseline records and keeps writing numbered records until `VBoxManage controlvm <vm> poweroff`; the verifier releases the leftover writer locks (operator unlock), recovers journals, and asserts the baseline is byte-identical with no temp/journal/lock leftovers. Steps in `docs/progress/2026-11-05_002_需要你亲自参与的隔离测试（rc.11_候选）.md`. |
| `manual/power-loss.ps1` | Repeatable owner entry for the same drill: `-Action Prepare` starts the writer, `-Action Verify` runs the verifier and writes timestamped evidence under `<root>\evidence\` (never overwrites the reference run), `-Action Status` prints progress and leftover locks. |
| `manual/backup-memory.ps1` | One-command verified backup before a DSH update: snapshots the WH root (audit + archive included) with the maintenance CLI, verifies the snapshot, writes `backup-manifest.json` (SHA-256, file count), refuses while DSH runs unless `-AllowRunningDsh`, and supports `-CheckOnly`. Never modifies memory. |
| `manual/native-disconnect-cdp.mjs` | Owner-run native-disconnect drill: requires DSH started with `--remote-debugging-port`, blocks `*api/auto-memory-wh*` via CDP, asserts the save fails and the record file is unchanged, then unblocks and saves the same body again (no restore write, so `verified/pinned/disabled` are preserved). Evidence: `docs/evidence/<stage>/cdp.json`. |
| `manual/native-disconnect.ps1` | One-command wrapper: stops nothing itself but refuses while DSH runs, launches the isolated desktop with `--remote-debugging-port`, waits for CDP, runs `native-disconnect-cdp.mjs`, then closes that instance. |
| `manual/native-dynamic-close.mjs` | Owner-run dynamic-close drill (`--phase close/offline/post`): starts a same-body save, closes the app via CDP `Browser.close` ~5 ms later, releases stale locks and recovers journals offline, relaunches and compares the record. Evidence: `docs/evidence/<stage>/dynamic-close.json`. |
| `manual/native-dynamic-close.ps1` | One-command wrapper around the three dynamic-close phases; refuses while DSH runs and starts the isolated desktop twice. |
| `manual/mock-anthropic.mjs` | Synthetic Anthropic Messages endpoint (`POST /v1/messages`, SSE) used only by the active-assembly drill. It records each request body and answers `ASSEMBLY-SEEN <marker>` when the request text contains the marker, otherwise `ASSEMBLY-MISSING`. Run with `--port` and `--out <record.json>`. |
| `manual/native-active-assembly.mjs` | Owner-run native active-assembly drill: finds the real composer (`[data-composer-input]`), inserts a prompt through CDP `Input.insertText`, presses Enter, and asserts the mock model received a request whose system prompt contains the synthetic record, that a new `render_attempt` audit event lists the record, and that the reply rendered. Evidence: `docs/evidence/<stage>/active-assembly.json` (plus `dom.json`/`screen.png` on failure). |
| `manual/native-active-assembly.ps1` | One-command wrapper: refuses while DSH runs, writes a temporary `llm-deepseek.baseURL` patch into the isolated desktop profile, starts the mock model and the isolated desktop with CDP, runs the drill, then restores the profile patch. |
| `manual/real-migration-apply.ps1` | Owner-run real migration: refuses while DSH runs, re-inventories the source and compares its digest with the plan, applies with `approvedPlanHash` + `writersStopped`, inventories the new target, and writes counts/hashes only to `.work/real-migration/apply-result.json`. Plan: `.work/real-migration/plan-durable.json`. |
| `manual/daily-desktop-install.ps1` | Owner-run install of the candidate into the real `desktop` profile: checks the tarball hash, copies the manifest first, runs `dsh plugin add`, and verifies the bundle entry, dependency, version and `lib/index.js` hash. Writes `docs/evidence/S05-real-data-migration/desktop-install.json`. Close DSH first; `-CheckOnly` is read-only. |
| `manual/real-rollback-drill.ps1` | Owner-run rollback drill on the real `desktop` profile: snapshots `~/.dsh/memory-wh`, removes the plugin, verifies the memory bytes are unchanged, re-adds the candidate, verifies version/lib hash and memory bytes again. Writes `docs/evidence/S05-real-data-rollback/rollback.json`. Close DSH first; `-CheckOnly` is read-only. |
| `manual/daily-desktop-upgrade.ps1` | Owner-run upgrade of the real `desktop` profile from rc.11 to 0.1.0: verifies the recut tarball, backs up the manifest, runs `dsh plugin add`, and checks version, lib hash and bundle retention. Evidence: `docs/evidence/S05-real-data-migration/desktop-upgrade-0.1.0.json`. |
| `manual/daily-desktop-compat-fix.ps1` | Owner-run repair for DSH 0.2.2: after the runtime update the old 0.1.0 tarball is skipped as incompatible (peer list only covers 0.2.1-rc.5). Removes and reinstalls the recut tarball that declares `engines.dsh`, then verifies bundle entry, `engines.dsh`, version and lib hash. Close DSH first; `-CheckOnly` is read-only. Evidence: `docs/evidence/S05-real-data-migration/desktop-compat-fix.json`. |
| `concurrent-index-readers.mjs` | Four async index renders next to two writers: asserts the section never exceeds its byte budget, never contains cut characters, readers never throw, the final render is complete, and no lock/journal is left behind. |
| `candidate-distribution-audit.mjs`, `runtime-license-audit.mjs` | Tarball hygiene/parity/repack determinism and license/notice consistency. |
| `g0-zod-reachability.cjs` | Audits the host zod version/affected range and checks the plugin surface has no static path into host zod array schemas. Requires Electron Node. |
| `native-rc11-state.mjs` | `before`/`after` state snapshots for the isolated native desktop acceptance (`docs/progress/2026-11-05_008_rc.11_隔离桌面原生验收_runbook（所有者执行）.md`). |
| `native-desktop-plugin.ps1`, `native-desktop-wh-resume.ps1` | Owner-run native desktop install/check/launch/remove for the isolated profile. UTF-8 **with BOM**; Windows PowerShell 5.1 misparses them without it. `Check` accepts `-AllowRunningDsh` for a read-only preflight; install/launch/remove always refuse while DSH runs. |
| `backup-depth-matrix.mjs` | Multi-scope backup/restore depth: snapshot identity, two restores byte-identical, selection without audit/archive, project mapping acceptance/rejection, five stable backup signatures and restore after the source root is deleted. |
| `legacy-unknown-fields-matrix.mjs` | Unknown frontmatter fields survive read/write/archive/migration; invalid known fields are ignored; marker-less legacy roots are untrusted live but migratable (marker bootstrapped, bytes kept); strict migration rejects unknown versions/invalid enums/origins with explicit issues. |
| `index-budget-matrix.mjs` | Nine `maxBytes` values (128–16384): index section stays within budget, multi-byte characters are never cut, pinned first, exclusion reasons stable, truncation marker consistent, sync/async byte-identical, empty below frame size. |
| `soak-mixed-load.mjs`, `soak-worker.mjs` | Sustained mixed load: `soak-mixed-load.mjs [minutes] [uniqueWorkers] [churnWorkers]` spawns unique/churn writers with human-paced think time, samples list/index latency and asserts clean records, no leftovers and a bounded index. |
| `transfer-roundtrip.mjs` | Exports a synthetic scope, re-imports it into a fresh root and asserts checksum stability, candidate-only writes and conflict reporting. |
| `sync-offline-drill.mjs` | Two local roots exchange changesets: cursor advancement, tombstone deletions, verified-conflict default, explicit remote-wins and tamper rejection. |
| `sync-secure-drill.mjs` | Device identity drill: identity persistence, trust list, signed+encrypted envelope roundtrip, application as candidate, and rejection of untrusted sender, wrong recipient and tampered ciphertext. |
| `sync-envelope-drill.mjs` | Endpoint contract drill: export → seal → apply with cursor advance, idempotent replay, verified-conflict default, explicit remote-wins, tamper and wrong-recipient rejection (9 checks). |
| `storage-capacity-matrix.mjs`, `storage-acl-probe.mjs`, `storage-multiprocess-contention.mjs`, `scale-probe.mjs` | Earlier single-purpose probes kept for the historical rc.6–rc.10 evidence. |
