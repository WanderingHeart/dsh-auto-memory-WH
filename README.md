# DSH Memory

[中文说明](README.zh.md)

Persistent memory for DeepSeek Harness (DSH), derived from AskTheWay/dsh-auto-memory v1.3.0. The npm package is `dsh-auto-memory-wh`; upstream MIT attribution is preserved in [LICENSE](LICENSE), [UPSTREAM.md](UPSTREAM.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Current stable release: **1.0.1**.

This checkout contains the local **1.0.2** release candidate. It is not available from npm.

## What it does

- Stores memories as local Markdown under the WH data root.
- Keeps detailed project memories separate from concise user-level summaries that can be reused across projects.
- Injects a byte-bounded index into the host prompt; full bodies are read on demand.
- Provides memory tools, a web management UI, topic grouping, reversible lexical merging, JSON transfer, native reminders, and backup/recovery utilities.
- Can summarize sessions through the model configured in DSH. Automatic summarization and user scope default to enabled; the minimum-turn and minimum-character gates still apply.

Memory type (`user`, `feedback`, `project`, or `reference`) is a content category, not a visibility boundary. All four types can exist in project or user scope.

## Requirements and installation

Declared compatibility is DSH `>=0.2.1-rc.5 <1.0.0`, Node `^22.19.0 || >=24.0.0`, and the exact host peer ranges in [package.json](package.json). This declaration is not evidence that every allowed combination or Desktop build has been tested.

The unreleased source explicitly accepts `0.2.2-rc.4` and `0.2.2-rc.5` host peers. This does not change the metadata of the published `1.0.1` package. Run `npm run check:dsh -- 0.2.2-rc.4` or `npm run check:dsh -- 0.2.2-rc.5` to verify the source.

Prefer the DSH Desktop plugin manager. For an isolated CLI profile on the known Windows Desktop layout:

```powershell
& 'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile wh-trial add 'dsh-auto-memory-wh@1.0.1' --ignore-scripts
```

Use the embedded CLI that belongs to your Desktop installation and the profile actually used by that installation. Fully exit and restart DSH after changing plugins. Only one plugin that owns `memory_write`, `memory_read`, `memory_list`, `memory_search`, or `memory_delete` may be enabled in a profile; WH fails startup instead of silently replacing an existing owner.

Source installs run the package `prepare` build and therefore need the declared development toolchain. The published npm package is prebuilt.

## Configuration

The default root is the host-resolved `$DSH_HOME/memory-wh`. An explicit `memoryDir` must be an ordinary absolute path. Pointing it at an existing unmarked directory is not migration approval: WH refuses writes to non-empty storage without its format marker.

Important defaults are `edition: full`, `maxBytes: 4096`, `enableUserScope: true`, `autoSummarize: true`, `autoSummarizeIdleMinutes: 60`, `autoMerge: true`, and `autoBackup: false`. See [docs/configuration.md](docs/configuration.md) for the validated ranges and edition feature matrix.

Automatic summarization calls the host model and can consume tokens. Basic file storage, index rendering, search, and lexical merge scoring do not themselves call a model. `minimal` disables optional summarization, reminders, backup, merge, transfer, and graph features while retaining the core memory tools and index.

## Data, privacy, and security

Memory records, settings, archives, transaction journals, audit events, and optional backups remain under the configured WH root unless you explicitly export, sync, or copy them. The plugin does not need API keys of its own. Model requests are routed through DSH using the configured provider and may include the bounded memory index or a session transcript used for summarization; “stored locally” therefore does **not** mean that memory content never leaves the device.

Stored memory is treated as background data, not as trusted instructions. The implementation rejects several obvious secret formats and instruction-injection patterns, but these are heuristic filters, not a complete privacy or prompt-injection defense. Do not store credentials. Audit logs record memory names and outcomes, not a second copy of full bodies, but names can still be sensitive.

Writes use file locks, same-directory replacement, transaction journals, and bounded path/file checks. Prepared transactions roll back; committed transactions finish cleanup. Corrupt or unknown storage is failed closed for review. Windows directory `fsync`, physical power loss, malicious same-user races, network filesystems, and every permitted DSH/Node/platform combination are not fully certified.

Deletion is recoverable archival, not secure erasure. Archives, snapshots, backups, exports, sync peers, and provider logs may retain content.

## Upgrade, backup, restore, and removal

Before upgrading, close DSH and make a verified offline copy of the complete WH root and the target profile manifest. Keep the previous package or lockfile. Upgrade the package, restart DSH, and verify the management page and a synthetic write/read in the intended project. Software rollback does not undo later data changes.

For a consistent offline snapshot, stop all writers and use the packaged maintenance CLI described in [docs/storage-recovery.md](docs/storage-recovery.md). Automatic backups are best-effort multi-file copies and are not equivalent to an offline snapshot. Restore always targets a new directory and refuses overwrite; switching DSH to the restored root is a separate operator action.

Removing the plugin does **not** remove its data. To uninstall, first export or back up what you need, remove or disable the package through the same DSH profile manager, and restart DSH. For data removal, confirm the exact configured `memoryDir`, keep DSH stopped, and remove that directory separately. Permanent privacy deletion must also cover `.archive`, `.backups`, exports, sync copies, external backups, and any provider-side retention. Never assume `$DSH_HOME/memory-wh` when an explicit `memoryDir` may be configured.

## Troubleshooting

- **Plugin does not load:** check the DSH/Node/peer ranges, restart DSH, and ensure another memory plugin does not already own the five core memory tools.
- **Storage busy or recovery required:** stop every writer. Do not delete lock or journal files blindly; follow the inventory, recovery, and hash-checked unlock flow in [docs/storage-recovery.md](docs/storage-recovery.md).
- **Existing directory requires migration:** do not add the marker by hand. Plan and rehearse migration to a separate target.
- **No summaries appear:** confirm `standard` or `full`, `autoSummarize: true`, a usable model route, and the configured turn/character gates. Failures preserve the conversation and are logged without writing a fabricated memory.
- **No whale notification:** the optional `window.__dshWhaleNotify` integration is external and is not shipped or installed by this package. Core memory and native reminders do not depend on it.

## Evidence and known limits

Repository CI covers Windows and Linux with Node 24. The release-readiness review dated 2026-11-17 ran a clean locked install, typecheck, build, 653 synthetic tests, package inspection, and dependency advisory checks. It did not rerun a native DSH Desktop UI session, a real-model call, real user-data migration, real two-device relay, physical power-loss testing, or mobile testing. See [docs/release-readiness](docs/release-readiness/) for the exact distinction between executed, static, skipped, and owner-required checks.

Lexical matching can merge the wrong records or miss related ones. Model-generated summaries can be incomplete or inaccurate. Review important memories and keep independent backups.

Packaged references: [configuration](docs/configuration.md), [injection and UI](docs/trust-ui.md), [storage and recovery](docs/storage-recovery.md), and [changelog](CHANGELOG.md).

## License and provenance

MIT. Copyright and provenance from the upstream project remain intact. The software license does not authorize publishing user memory data.
