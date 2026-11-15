> 公开脱敏版：保留当时的版本、结果与限制；本机路径已泛化，原始日志/截图和私人操作记录不公开。历史描述不代表当前版本。

# DSH compatibility — current status and historical verification

## Current snapshot (2026-11-05, rc.11 candidate)

The tables below this snapshot are **historical stage records**. Their earlier “NOT RUN” or “NOT IMPLEMENTED” cells describe the stage named in each heading, not today's project state. For the current gate decision, use [release readiness](2026-11-06_018_发行前门槛清单.md) and the [plain-language status](2026-11-09_018_持久记忆_WH（dsh-auto-memory-wh）阶段总结报告.md).

rc.10 changes no compatibility surface: it only makes the audit/snapshot version a single source. The rc.10 isolated host evidence is in [r80](2026-11-05_025_rc.10_版本字段单一来源与隔离复核.md); native Desktop rc.10 is not yet tested. rc.11 is documentation/metadata only (public path cleanup and version bump); its isolated host, distribution and peer checks are in [r85](2026-11-05_030_rc.11_公开发布路径清理与隔离复核.md), and native Desktop rc.11 is not yet tested.

| Area | Current evidence | Remaining boundary |
|---|---|---|
| Host version | Desktop `0.2.1-rc.5` nightly; packaged `dshBuildCommit` and `app.asar` fingerprint recorded below | Commit is packaged metadata, not an independently signed build identity |
| Native Desktop blank host | Normal user opened the original Desktop offline in new isolated directories; Desktop profile was created and the window closed with no remaining DSH process, [r58](2026-11-04_035_rc.8_正常用户空白桌面启动.md) | Login, WH installation and native WH UI were not exercised |
| Installer and lifecycle | rc.8 installed in isolated CLI profile `wh-s05`; upgrade, rollback, reinstall and unload checks in [r51](2026-11-04_028_rc.8_异步保存焦点与断连恢复.md) | Desktop-managed profile installation has not been tested |
| Web UI and authentication | Isolated Web management page, authenticated HTTP, revision conflicts and reconnect behavior; see [r51](2026-11-04_028_rc.8_异步保存焦点与断连恢复.md) | Native Desktop window interaction remains blocked |
| Resume, compaction, child sessions | Synthetic host lifecycle and fake local model/service paths have stage evidence; see [r38](2026-11-04_015_rc.4_活动会话撤销与重建.md) and [r52](2026-11-04_029_rc.8_宿主会话与候选包核对.md) | No real model or native Desktop child-agent end-to-end acceptance |
| Storage and migration | Synthetic backup, restore, recovery, ACL denial, process exits and 2,000-record scale checks; see [r54](2026-11-04_031_rc.8_子进程退出恢复矩阵.md) and [release readiness](2026-11-06_018_发行前门槛清单.md) | No authorized real-memory migration, actual power loss or physical disk-full test |
| Package | rc.8 local archive and isolated runtime licenses checked in [r55](2026-11-04_032_rc.8_分发声明与运行时许可核对.md) | Final publication obligations and host-side dependency risk remain open |

The earlier sandbox-account native attempt failed before profile creation; [r58](2026-11-04_035_rc.8_正常用户空白桌面启动.md) records a later successful **blank host** launch under the normal user. The earlier failure's exact cause remains unproven; blank host success does not establish WH Desktop compatibility.

## Historical stage records

Date: 2026-11-03 (Asia/Shanghai). This matrix records observations, not an assertion of complete Desktop compatibility.

## Confirmed local environment

| Item | Observed value |
|---|---|
| Desktop version | 0.2.1-rc.5 |
| Update channel | nightly, from app.asar/package.json |
| Embedded CLI | C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd |
| Embedded CLI --version | 0.2.1-rc.5 |
| dshBuildCommit | d4db512a969fccf0c5cc7ec8fe38e9c1d27af916 |
| dshBuildDirty | false |
| app.asar SHA-256 | e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915 |
| app.asar size | 182766714 bytes |
| Embedded Node / Electron | 24.21.0 / 44.7.0 |
| Build-machine Node | 24.22.0 |
| Actual cordis / schemastery | 4.0.5 / 3.18.5 |
| Inspected DSH core packages | 0.2.1-rc.5 |

The previous screenshot did not find a build field. Reading the root package metadata reveals dshBuildCommit and dshBuildDirty. The commit is packaged metadata; no claim is made that this is a verified signed build or that the Git commit has been independently fetched.

Do not invoke the global dsh command. Its older version is user-reported; it was deliberately not used.

## Verification matrix

| Capability | Status | Evidence / limit |
|---|---|---|
| Fixed upstream build | PASS | upstream-build.log |
| Locked-dependency upstream tests | PASS: 202/202 | upstream-tests.json; dependency versions differ from current Desktop |
| Source build versus npm release | PASS for four compared files | package-comparison.json |
| Actual host home resolver | PASS | isolated DSH_HOME honored |
| Five required tools registered | PASS | desktop-host-probe.json |
| Synthetic write and read | PASS | actual host atomic-write dependency, isolated root |
| Nonempty Prompt section + rendering | PASS | 1381 bytes, budget 4096 |
| Plugin disposal removes tools | PASS | direct Cordis service probe |
| Desktop plugin installer/loader | NOT RUN | no plugin installed into a real or test profile |
| Desktop/Web UI interaction and authentication | NOT RUN | static protocol inspection only |
| Resume, compaction, child agents | NOT RUN | scheduled for integration testing |
| Migration/backup/rollback | NOT IMPLEMENTED | S03 |
| Actual user memory | NOT ACCESSED | synthetic test data only |

The host probe rewrites external DSH imports in a disposable copy of the built plugin to the actual app.asar modules, while keeping the real project source and build output unchanged. It uses embedded Electron in Node mode, real Cordis/SystemPrompt/ToolRuntime services, and synthetic data. This demonstrates those services work together; it does not exercise the official plugin loader, permissions pipeline, real UI, or model requests.

## Prerelease range issue

The embedded semver implementation returns false for satisfies('0.2.1-rc.5', '>=0.1.5-rc.2 <0.3.0') with default options, and true with includePrerelease:true. Therefore the screenshot's range check cannot establish default package-manager acceptance. S02 now declares core peer alternatives 0.1.5-rc.2 || 0.2.1-rc.5 explicitly. The actual DSH installer policy and client dependency resolution remain untested; an accepted peer declaration alone does not establish runtime compatibility.

## Client inspection

The host node_modules tree does not expose dsh-client-ui-slots as a standalone package at the inspected location. However, the installed sidebar client bundle still contains sidebar.panellist and slots.register, and the layout/sidebar bundles retain window.__ModuleLoader__.load wrappers. The package absence is not proof that the slot service is absent: client baseline modules can be provided through a separate bundle. Actual module resolution and panel operation remain to be tested.

## Important upstream-to-spec gaps

- Upstream registers seven tools: the required five plus memory_prune and memory_delete_all. Bulk operations have approval hooks, but the independent project must explicitly define exposure and test the real approval pipeline.
- Upstream single-record delete calls unlink; it does not implement the required recoverable archive deletion.
- A newly written ordinary model record may have no trust status and can enter the index; strict candidate-by-default behavior is a new requirement.
- Upstream audit records changes in the injected set, not necessarily every rendered request.
- Backup, migration dry-run, recovery transactions and rollback remain distinct S03 work.

G0 baseline source/package identity: verified; third-party review still incomplete. G1: core-service subset passed, full installer/client/session compatibility still open. G2–G5: not passed.

## S02 verification (0.1.0-dev.0)

All evidence below is under docs/evidence/S02. No real profile or memory store was used.

| Check | Result | Evidence / scope |
|---|---|---|
| Clean locked installation | PASS, 103 installed packages | clean-install.log; offline project-local cache, lifecycle scripts disabled |
| Typecheck | PASS | typecheck.log |
| Regression | PASS, 213/213 | tests.json; original dependency baseline, including 11 new WH tests |
| Build | PASS | build.log |
| Actual Desktop core-service probe | PASS, five checks | desktop-host-probe.json; 0.2.1-rc.5, synthetic data, memory-wh:index rendered to 1381 bytes within 4096 |
| Package and client registration contracts | PASS | package-smoke.json and package.json; name, ID, API, locale, required notices and file allowlist |
| Real client factory execution and panel interaction | NOT RUN | registration wrapper inspected; factory not executed |
| Official install/upgrade/uninstall and permissions | NOT RUN | package is local only, no installation |
| Resume, compaction and child agents | NOT RUN | no change to S01 integration gap |
| Recovery, migration and soft deletion | NOT IMPLEMENTED | scheduled for S03 |

The host probe still uses the disposable import-rewriting method described above. The package smoke check is not a browser test. S02 engineering scope is complete, but full G1 compatibility and G2–G5 remain open. The temporary minimum maxBytes of 4096 is a configuration restriction pending S04 small-budget rendering work, not fulfillment of the final specification's tiny-budget requirement. Tool conflict detection protects WH loading after an existing owner; it cannot enforce how legacy plugins loaded later behave.

## S03 verification (0.1.0-alpha.0)

This section supersedes the earlier “not implemented” storage rows for implementation status, while preserving their historical test context. Evidence is in docs/evidence/S03.

| Check | Result / scope | Evidence |
|---|---|---|
| Regression + recovery tests | 238/238; 25 new storage/recovery tests, locked dependency baseline | tests.json |
| Typecheck/build | PASS; includes maintenance CLI | typecheck.log, build.log |
| Built maintenance CLI | PASS, five checks: plan, offline migration, byte preservation, backup verify, new-directory restore | maintenance-cli-smoke.json |
| Actual Desktop core services | PASS, five synthetic checks; same disposable-import technique | desktop-host-probe.json |
| Package contracts | Required notices, maintenance guide and CLI included; data excluded | package-smoke.json, package.json |
| Crash recovery | Actual abrupt child exit, explicit lock recovery and rollback; committed cleanup also tested | storage-recovery.spec.ts results in tests.json |
| Concurrent writers | Four child processes retain independent records; optional revision conflicts tested | tests.json |
| Offline migration | Dry-run no writes, raw records retained, mappings required, source changes rejected, interrupted phases resumable | tests.json |
| Real user data/profile/configuration | NOT ACCESSED OR CHANGED | synthetic fixtures only |
| Physical power loss / actual disk exhaustion | NOT RUN | injected ENOSPC/EACCES and space responses are simulations |
| Windows ACL / network filesystem / hostile same-user directory races | NOT FULLY VERIFIED | junction and lexical escape checks are only a subset |
| Full UI/API optimistic concurrency and authorization | NOT COMPLETE | store expectedRevision is optional; integration remains |

G2 and G3 remain **partial/open**, not passed. Scope transactions and offline migration primitives have synthetic evidence; this is not end-to-end production readiness. Per-request audit, strict candidate defaults and complete host integration remain subsequent work. Functional test timeouts were raised to 15 seconds with four workers to accommodate durable I/O; that is not a performance acceptance result.

## S04 verification (0.1.0-beta.0)

This section updates the historical gaps above; evidence is in docs/evidence/S04. Strict candidate defaults, semantic review fingerprints, revision checks in model/API mutations, bounded full-fragment rendering and per-callback render_attempt audit are implemented. The new management UI uses Chinese copy.

| Check | Result / scope | Evidence |
|---|---|---|
| Tests | 250/250 in 20 files, including 5 actual React DOM interaction tests on happy-dom | tests.json |
| Typecheck / build | PASS | typecheck.log, build.log |
| Production management handlers | Authentication rejection, scope enforcement, review, CAS, paging/export/archive, size limits; synthetic carrier | memory-api.spec.ts in tests.json |
| Desktop core services | 6 checks, actual 0.2.1-rc.5 packages, isolated data; candidate excluded and reviewed fixture renders to 478 bytes | desktop-host-probe.json |
| Built maintenance CLI | Five recovery/migration checks pass again with S04 bundle | maintenance-cli-smoke.json |
| Package | 15 files; required notices and guides, no data/cache; client registration wrapper inspected | package-smoke.json |
| Real Desktop UI/loader/authentication | NOT RUN; happy-dom and rewritten-import host probe do not replace these checks | S05 gap |
| Resume / restart / compaction / child sessions | NOT RUN | S05 gap |
| Large-scale performance, physical power loss, ACL, authorized real-data copies | NOT COMPLETE | G2/G3 gap |

The temporary 4096-byte minimum is removed: maxBytes supports 0–65536 with whole-fragment accounting. A review hash is an integrity aid, not an authenticated signature. Unknown storage versions do not inject. Downgrading to S03/upstream on a current S04 data root is unsafe because old candidate trust semantics differ. G1 remains partial and full G2/G3/G4/G5 are not passed. No actual plugin installation, real profile change or public release occurred.

## S05 verification (0.1.0-rc.0)

This section supersedes the historical S04 installation/UI gaps only for the tested isolated Web profile. Exact Desktop baseline remains 0.2.1-rc.5 nightly, build d4db512a969fccf0c5cc7ec8fe38e9c1d27af916. See [S05 report](2026-11-03_006_阶段更新讲解：隔离安装与第一版候选验收.md).

| Check | Result / limits | Evidence in docs/evidence/S05 |
|---|---|---|
| Regression / types / build | 256 tests in 21 files; PASS | tests.json, typecheck.log, build.log |
| Official CLI lifecycle | beta→rc, remove, offline reinstall, beta rollback, rc restore; corrupt package rejected; 7 memory file hashes unchanged | isolated-lifecycle.json |
| Real Web client | Official installed package; create/review/pin/mute/archive/restore/conflict; user/project separation; restart persistence | ui-conflict.jpg, ui-rc.jpg, browser-acceptance.json |
| Real HTTP auth/Loader | Cookie required, cross-origin rejected, route unload/remount and disposal map cleanup; synthetic lifecycle events and rewritten imports | host-http-probe.json |
| Export | Two individual downloads, raw byte/hash and scope checks | export-check.json |
| Core / offline maintenance | 6 core checks and 5 maintenance checks PASS | desktop-host-probe.json, maintenance-cli-smoke.json |
| 0/1/6/100/2000 records | Budget PASS; 2000 render P50 1552.92 ms, list 2305.38 ms, not low-latency acceptance | scale-probe.json |
| Static peers check | FAIL: 8 host peers absent from profile-local pnpm tree; official host successfully runs package; no compatibility exemptions | peer-check.log |
| Native daily Desktop / model compaction / child agents | NOT RUN | G4 remains open |
| Dark theme / full keyboard and accessibility | NOT RUN | visual evidence is light theme at 1280×720 |
| Real data / physical power loss / ACL | NOT RUN or partial earlier synthetic coverage | G2/G3 remain open |

First Web launch exposed a host default-workspace path outside DSH_HOME; it may have initialized the OS Documents default directory. The test was stopped and Documents explicitly redirected before subsequent tests. No real memory or model keys were used; see the report for the exact footprint and retained checkpoints. Test server is stopped. No publication or Git metadata bypass occurred.

## S05 rc.1 isolated upgrade

The embedded 0.2.1-rc.5 nightly CLI upgraded the authorized `wh-s05` synthetic profile from rc.0 to rc.1. The actual isolated Web panel loaded and showed a reviewed synthetic memory. Offline rollback to rc.0 and restoration to rc.1 left all seven synthetic memory files byte-identical. Typecheck, build, and 267 tests passed. See [r13](2026-11-03_018_rc.1_隔离升级与页面验收.md). No real model call, compaction or child-agent run was performed; G4 remains open.

The subsequent worktree has an `AbortSignal` fail-closed check and 268 passing tests. A five-run synthetic 2000-record Cordis/SystemPrompt assembly benchmark measured 891.82 ms median. The installed rc.1 archive does not include the new cancellation check. See [r14](2026-11-03_019_rc.1_异步组装规模与事件边界.md). A complete section overrides WH after waterfall, while WH audit still denotes a render attempt rather than confirmed model receipt.

## S05 rc.2 isolated acceptance

The embedded Desktop CLI upgraded the authorized synthetic `wh-s05` profile from rc.1 to rc.2. The actual isolated Web panel loaded, the host Loader/HTTP probe passed, and an offline rc.1 rollback followed by rc.2 restoration left all seven synthetic memory files byte-identical. The installed bundle contains the abort issue marker. Typecheck, build and 268 tests passed. See [r15](2026-11-03_020_rc.2_隔离候选包验收.md). No real model request, compaction or child agent was run; G4 remains open.

An installed rc.2 host-lifecycle probe now covers synthetic parent/child project isolation, pre-aborted assembly, new synthetic sessions after Loader unload/reload, complete-section precedence, and zero-byte aborted audit after shutdown drain. See [r16](2026-11-03_021_rc.2_宿主生命周期补充验收.md). Real subagent execution, compaction/resume and model cancellation remain untested; T18 and G4 are still partial.

The packaged 0.2.1-rc.5 `SessionStore` probe now uses real root/fork/child session objects with the installed rc.2 bundle. Project scoping, direct surface replacement and in-memory snapshot seeding pass. See [r17](2026-11-03_022_rc.2_实际会话存储与表面替换.md). These do not execute the compaction command, subagent factory or durable resume backend; T18/G4 remain partial.

Packaged fork/spawn provider preparation now passes with real `SessionStore` objects and the installed WH bundle: fork excludes an open turn and retains parent project scope; spawn starts without inherited events and uses its own project scope. The compact command/basic engine path was inspected but not executed. See [r18](2026-11-03_023_rc.2_子代理准备与压缩入口边界.md). T18/G4 remain partial.

The actual packaged basic compaction engine has now completed one isolated transaction with a local fake LLM, meter and maintenance agent. It committed start/summary/end events and surface replacement; installed WH injected the same reviewed current-source memory before/after, then rejected an externally edited record with a zero-byte candidate audit. One fake model call, zero intercepted network attempts, 268 tests pass. See [r19](2026-11-03_024_rc.2_真实压缩引擎与_WH_注入审计.md). Real routing, durable backend, UI command, failure/cancellation and real subagent execution remain untested; T18/G4 are partial.

The actual `/compact` adapter and basic engine now pass isolated success, fake-summary-error, and mid-summary-cancellation probes with installed WH. Failure/cancellation preserve the original surface; WH injection is stable and six pre/post audit attempts match. A clear/write concurrency test assertion was corrected to accept both valid lock orders; 268 tests pass. See [r20](2026-11-03_025_rc.2_压缩命令成功、失败与取消.md). Durable session recovery, real agent loop/model route, UI invocation and subagent execution remain open; T18/G4 are partial.

The packaged JSONL session backend now persists a 14-event compacted synthetic session; a second Electron Node process reopens it, reconstructs the compacted surface, and installed WH injects the reviewed current-source record. Three pre/post/reload audit entries match, one local fake model call and zero intercepted network attempts. The write handle is attached manually rather than by the real agent loop; see [r21](2026-11-03_026_rc.2_跨进程压缩会话持久恢复.md). T18/G4 remain partial.

The packaged agent loop now automatically routes the compacted synthetic session's 14 events to JSONL; a second Electron Node process resumes it through `ctx.agents.resume()`, preserving the compacted surface and allowing installed WH to inject and audit the reviewed current-source record. Two audits match, one local fake model call and zero intercepted network attempts; 268 tests pass. The caller remains an isolated probe rather than the desktop UI, and real subagent/model routes are not covered. See [r22](2026-11-03_027_rc.2_自动持久化与_agent_loop_恢复.md). T18/G4 remain partial.

Real packaged spawn/fork providers and working-directory service exposed a project-scope bug in installed WH rc.2: a spawn child changing to a separate synthetic project still received its parent's reviewed project memory because WH used the immutable session header cwd. The working-tree fix uses the host's effective current directory for injection, tools, management mapping and consolidation; the isolated provider probe now passes with two fake child model calls, five audits, zero intercepted network attempts and 271 tests. The installed rc.2 package has not been upgraded; see [r23](2026-11-03_028_子代理当前目录与记忆范围修复.md). G4/T18 remain partial.

The rc.3 local candidate containing that fix is now installed only in the authorized `wh-s05` synthetic profile. The embedded Desktop CLI upgraded rc.2 to rc.3 offline, rolled back to rc.2, and restored rc.3; all seven synthetic memory files stayed byte-identical at each checkpoint. The installed rc.3 bundle passes packaged spawn/fork, current-directory scoping, memory tool isolation and audit probes with two fake model calls and zero intercepted network attempts. Typecheck, build and 271 tests pass. See [r24](2026-11-03_029_rc.3_隔离升级与子代理范围验收.md). Desktop UI invocation, real model routing and static peer warning resolution remain open; G4/T18 are partial.

The embedded CLI's rc.3 `plugin peers check` still exits 1 with eight missing profile-local peers. Inspection confirms all eight absent from the profile pnpm tree, while the packaged Desktop host has matching versions (cordis 4.0.5; seven DSH packages 0.2.1-rc.5). This explains the warning's topology but does not make the static check pass. The isolated rc.3 Web entry and authenticated WH read-only API each returned 200; the server was stopped and seven synthetic memory files remained unchanged. See [r25](2026-11-03_030_rc.3_宿主依赖拓扑与隔离_Web_入口.md). Browser click-through and real model/UI agent flows remain open; G4/T18 are partial.

The isolated rc.3 browser UI now opens the WH panel, displays reviewed synthetic user/project records, shows text-only detail, requires explicit session selection for project scope, filters the project list, and opens the audit panel. The selected synthetic project currently has no audit rows because this browser run made no model/assembly request. The tab/server were closed and seven synthetic memory files stayed unchanged; 271 tests pass. See [r26](2026-11-04_003_rc.3_浏览器管理页面隔离验收.md). UI agent/compaction/resume flows and static peer warning resolution remain open; G4/T18 are partial.
