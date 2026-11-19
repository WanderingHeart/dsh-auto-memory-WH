# Third-party dependency declarations

Updated 2026-11-17 for `dsh-auto-memory-wh@1.0.1` and the committed lockfile.

Upstream code: AskTheWay/dsh-auto-memory v1.3.0, MIT. The upstream copyright and license text are preserved in [LICENSE](LICENSE) and the exact source revision is recorded in [UPSTREAM.md](UPSTREAM.md).

The npm tarball contains the plugin's built JavaScript and declarations but does not embed dependency directories. The following packages are installed by the package manager for the plugin's direct runtime dependency graph:

| Resolved package | Locked version | Declared license | LICENSE SHA-256 |
|---|---:|---|---|
| `@deepseek-ai/cosmokit` | 1.8.3 | MIT | `034FB52B1D57360ECBAE6CB1632A88F86FD7C3D3F5631A5F082710203DDA0BE7` |
| `@deepseek-ai/schemastery` | 3.18.2 | MIT | `034FB52B1D57360ECBAE6CB1632A88F86FD7C3D3F5631A5F082710203DDA0BE7` |
| `@standard-schema/spec` | 1.1.0 | MIT | `653B779005A3A4D64A7288C940F7B9A0E8F0B1E0375F6AA6AF9473CAF131E564` |
| `yaml` | 2.9.1 | ISC | `5BBA27375D93E9119F76C1015F7672CF9AD5F70952296E0842FB2243D6376869` |

The DSH and Cordis peer packages are supplied by the host and are not bundled in this tarball. Their versions and license obligations depend on the target host installation.

The complete development lock contains 160 package entries, including 51 optional platform entries and 17 peer entries. Every entry declares a license: MIT (139), MPL-2.0 (12), ISC (4), Apache-2.0 (3), BSD-2-Clause (1), and BSD-3-Clause (1). Development-only packages are not shipped in the npm tarball. The authoritative package-by-package versions, integrity hashes, optional/peer flags, and declared licenses are in `package-lock.json`; duplicating that generated inventory here previously allowed it to become stale.

This notice is an engineering inventory, not legal advice and not a determination that every upstream notice obligation has been exhausted. The 2026-11-17 audit found no npm advisories in either the production graph or the full locked graph after the Vitest/Vite patch update and compatible Rolldown pin. Advisory databases change, so rerun `npm audit` for each release candidate. Software licenses do not cover or authorize disclosure of user memory data.
