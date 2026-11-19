# Project guidance

- Project display name: DSH Memory; package name: dsh-auto-memory-wh.
- Stage explanations belong only in docs/progress/ with an index in docs/progress/README.md. Use YYYY-MM-DD_NNN_<topic>.md (date, zero-padded within-day sequence, topic); preserve original stage/version/revision in report bodies. Keep previous stage reports.
- Version update documentation belongs in root CHANGELOG.md.
- Overall specifications remain in the sibling ../memory folder.
- Retain upstream MIT notices, provenance and archived upstream history. Do not invent author names or a personal repository URL.
- Use the embedded Desktop CLI C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd. Do not invoke global dsh for Desktop verification.
- Build/test with synthetic data in isolated roots. Real memory migration and publication require explicit authorization.
- .work is scratch data. Do not commit or distribute it, actual memory, credentials or app.asar.
- Validate relevant changes with typecheck, regression tests and build; record the evidence and untested limits in the stage report.
- Release cadence: one minor version at a time. Cut the version, build/pack, and run the isolated acceptance entry before starting the next minor version; a candidate must not contain features planned for a later version. If development has already moved ahead, snapshot the later-version files aside (e.g. under .work/) and restore them after acceptance.
- Current Git metadata writes are environment-restricted. Do not replace or relocate .git to bypass that restriction.
- Follow-up ideas and the post-project reminder live in docs/attachments/roadmap.md. When this plugin reaches v1.0 (public release or the owner declares it complete), remind the owner to start the two unrelated ideas tracked there (web DeepSeek switcher; mobile DSH client).
