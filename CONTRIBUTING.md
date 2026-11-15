# Contributing

This project is an independent derivative of AskTheWay/dsh-auto-memory. Preserve upstream attribution and existing copyright.

Use the lockfile: npm ci --ignore-scripts, npm run typecheck, npm test, npm run build. Test with synthetic memory in temporary directories; do not use a real DSH memory store or real credentials.

Keep stage reports in docs/progress and maintain its index. Version changes belong in the root CHANGELOG.md. Record source, schema, configuration and compatibility changes separately. For changed DSH integrations, distinguish declared version ranges, direct host-service tests, and real profile/UI tests.

Do not publish from this development branch. Automatic publishing is deliberately disabled until a reviewed release is explicitly authorized. Submit neither real memories nor secrets, app.asar copies, caches or generated test homes.
