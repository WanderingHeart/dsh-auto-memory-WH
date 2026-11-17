# Next steps

Date: 2026-11-17 (Asia/Shanghai)

## Release decision

Status: **conditionally ready for Draft PR review; not ready for catalog submission**.

No architecture or storage-format migration is recommended. The remaining gates are validation and repository/catalog operations that should occur only after review.

## Required before merging the repository PR

1. Review the final diff, especially the changed privacy/removal language and the Vitest/lockfile update.
2. Confirm remote CI passes on both Windows and Ubuntu with Node 24.
3. Run the final clean-install/check/audit/pack sequence recorded in `04-test-results.md` and keep the exact final output.
4. On an isolated DSH Desktop profile using the intended release build, install the package built from the final commit and verify:
   - cold startup and visible compatibility diagnostics;
   - management page rendering and one synthetic project/user memory round trip;
   - prompt index injection without reading a real store;
   - disable/unload/re-enable and full Desktop restart;
   - repeated initialization only after prior context disposal;
   - automatic-summary off/on behavior using a non-sensitive synthetic conversation;
   - shutdown while no writes are active, followed by clean restart;
   - removal leaves the synthetic data root intact.
5. Record the exact Desktop/DSH/Node/peer versions. Do not generalize the result to every version allowed by the manifest.

## Required before an npm or GitHub release

Publication was out of scope and must remain a separate owner action.

- Choose whether these changes warrant 1.0.2; do not overwrite the published 1.0.1 tarball.
- Update version, lockfile root version, `src/identity.ts`, and CHANGELOG together if cutting a release.
- Rebuild from a clean checkout and inspect the actual tarball, not only a historical evidence file.
- Re-run full and production dependency audits; advisory state changes over time.
- Verify runtime license versions/hashes and upstream attribution remain present.
- Preserve the complete Git history and release from the reviewed commit only.
- Keep the previous package and a verified synthetic rollback path.

## Required before the current dsh-market catalog PR

1. Verify or add the `dsh-plugin` topic on `WanderingHeart/dsh-auto-memory-WH`.
2. Complete the final native Desktop gate and release a reviewed version if needed.
3. Recheck the live [market README](https://github.com/dsh-market/dsh-market#submit-your-plugin) and [registry contribution guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) in case requirements changed.
4. Confirm `data/plugins/WanderingHeart__dsh-auto-memory-WH.yml` is still absent to avoid duplication.
5. Submit only the one YAML file shown in `03-market-submission.md` to `awesome-dsh-plugin/awesome-dsh-plugin`; do not submit it to `dsh-market/dsh-market` or the legacy `polang233/dsh-plugin-index` path.
6. Keep the description factual and update it if the final release removes or changes any named feature.

## Recommended follow-up, not a release blocker

- Add a small automated notice-consistency check that derives runtime versions from `package-lock.json` so `THIRD_PARTY_NOTICES.md` cannot drift silently.
- Add an isolated Cordis lifecycle test that explicitly applies, disposes, and reapplies the plugin context while asserting no timers/routes/tools remain.
- Add a CI package-manifest check using `npm pack --dry-run --json --ignore-scripts` and an allowlist of the 15 expected paths.
- Consider a documented retention/purge design for archives and backups. This would be a data-destruction feature and therefore needs separate design review and explicit user confirmation; it is not part of this branch.
- Consider dedicated secret scanning in CI. The local regex scan is useful hygiene, not equivalent coverage.

## Owner-only operations intentionally not performed

- publishing to npm;
- creating a GitHub Release;
- merging any repository PR;
- changing real user memory or a daily DSH profile;
- permanently deleting data;
- opening or merging the official catalog PR.
