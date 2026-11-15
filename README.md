# dsh-auto-memory-WH

[中文说明](README.zh.md)

Independent persistent-memory plugin derived from AskTheWay/dsh-auto-memory v1.3.0. Package: `dsh-auto-memory-wh`. Original attribution remains in [LICENSE](LICENSE), [UPSTREAM.md](UPSTREAM.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the upstream archive.

Stable release: **1.0.1**. Test evidence and package hashes belong to the [release report](docs/attachments/release.md).

Memories are local Markdown files. Bounded titles and summaries enter the prompt; bodies are read on demand. Since rc.10, records do not require manual approval: disputed, superseded, disabled and expired records are excluded. Topic grouping, reversible lexical merging, relationship views and JSON import/export are available. New reminders live in the host scheduler, not the memory store; optional whale notifications depend on an external integration.

Requires DSH `>=0.2.1-rc.5 <1.0.0`, Node `^22.19.0 || >=24.0.0`, and the host peer versions declared in package.json. This range is not a claim that every combination was tested.

Install the exact release using the Desktop embedded CLI and a fresh test profile:

```powershell
& 'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile wh-trial add 'dsh-auto-memory-wh@1.0.1' --ignore-scripts
```

Back up the profile manifest and memory-wh before a real upgrade. Restart DSH after installation. The plugin requires access to its profile and storage directories; administrator execution is not a general requirement.

Packaged docs: [configuration](docs/configuration.md), [injection and UI](docs/trust-ui.md), [storage recovery](docs/storage-recovery.md), [CHANGELOG](CHANGELOG.md).

Full source-repository docs (not all shipped in npm): [final report](docs/progress/2026-11-15_001_dsh-auto-memory-wh_结题报告（1.0.0-rc.17）.md), [release report](docs/attachments/release.md), [user guide](docs/attachments/user-guide.md), [development timeline](docs/progress/README.md).

Lexical merging can miss or incorrectly combine records. Real two-device relay, long-term reminders and mobile use have not been fully verified. Host model calls can transmit injected memory; local storage is not a promise that memory never leaves the device. Archiving is not secure erasure. The software license does not authorize publishing user data.


## Two-level memory (rc.18)

Project scope retains detailed context across sessions with the same project cwd. User scope retains concise cross-project abstracts. All four types (`user`, `feedback`, `project`, `reference`) work in both scopes; type is a content category, not a visibility setting.

Enable `autoSummarize: true` in the standard/full edition and keep `enableUserScope: true` for automatic extraction. Since rc.19, autoSummarize and enableUserScope both default to true; explicit false settings are respected. The existing summary request produces both project detail and a `userSummary` of at most 160 characters; no additional model request is introduced. Manual session summarization uses the same path. `memory_write` can also supply `userSummary`, which is saved automatically after the project write.

For example, details about a completed Ackermann car project and its VM remain in that project; other projects can receive “The user previously completed an Ackermann car project.” The summary keeps the original type. Repeated extraction updates its source-linked abstract; different projects do not overwrite one another. Abstracts do not copy detailed bodies, evidence quotes, paths, credentials or project topic ids. Obvious sensitive formats are rejected, but this is not a complete privacy classifier.

The model may omit an abstract if there is no cross-project value. Missing/invalid abstracts or failed writes retain the project detail and are reported in logs (or the tool result); details are never used as a fallback abstract. Disabling user scope stops abstract creation and injection. Existing memories are not automatically rewritten on upgrade. Manual panel edits/imports/archives do not run a model or rewrite the other layer; manage the two records separately when needed.

Each accepted project candidate may add one user abstract beyond `autoSummarizeMaxMemories`, which limits primary records. Summaries share the existing `maxBytes` injection budget. Index injection contains titles and descriptions; full bodies require tool reads.

## Upgrade, rollback and optional notifications

Back up the target profile, previous package and complete memory directory before upgrading. rc.18 keeps the storage format; generated abstracts are ordinary Markdown records. Rolling back to rc.17 preserves them but stops automatic maintenance. Software rollback does not undo memory changes.

Whale bubbles/sounds require an external compatible `window.__dshWhaleNotify` hook. The local whale patch is excluded from the release package, and other users must arrange the compatible integration themselves. Whale updates or reinstalls may overwrite the hook; check compatibility and reapply the appropriate patch. Core memory and native reminders work without it.

See the [Chinese README](README.zh.md) for configuration tables, editions and examples, and the [user guide](docs/attachments/user-guide.md) for detailed operations. Model quality is not guaranteed by deterministic synthetic tests.
