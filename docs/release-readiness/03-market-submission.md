# dsh-market submission evidence

Checked: 2026-11-17 (Asia/Shanghai). No listing PR or market submission was created.

## Current authoritative path

The market application repository is [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market). Its current README says under “Submit your plugin” that the market application is **not** the catalog and that plugin authors must open a PR in the curated [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) registry. It explicitly says not to add plugin entries to the market application repository.

The current authoritative contribution instructions are [awesome-dsh-plugin/contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md). The relevant requirements observed on 2026-11-17 are:

- add one file named `data/plugins/<owner>__<repo>.yml`;
- `url` must exactly match the repository;
- required fields are `url`, `name`, `category`, and `description.en`; Chinese description is optional;
- use a valid category; `memory` is the appropriate category here;
- repository `package.json` must declare an installable `dsh.bundle` patch, not only `dsh.client`;
- repository must contain working code and be at least one day old;
- repository must be actively maintained;
- add the `dsh-plugin` repository topic;
- description must be factual and free of marketing/superlatives;
- a PR may add at most three entries;
- generated READMEs should not be edited by hand; local generation is optional preview/validation;
- npm publication is optional, but when present the package `repository` must point back to the listed repository.

The registry explains that green CI validates shape, while a maintainer still reads source and checks description accuracy, duplication, surprising install-time behavior, and dependency provenance. Listing is not a security endorsement.

## Current repository status

| Requirement | Evidence | Status |
|---|---|---|
| Exact repository URL | `package.json.repository`, homepage, and npm 1.0.1 metadata point to `https://github.com/WanderingHeart/dsh-auto-memory-WH` | Pass |
| Installable DSH bundle | `dsh.bundle.patch=./cordis.patch.yml`; patch inserts `auto-memory-wh` / `dsh-auto-memory-wh` | Pass |
| Working source | 55-commit repository, TypeScript implementation, management client, tests, and 1.0.1 npm release | Pass |
| Age/maintenance | Imported upstream history plus current 2026-11-15 release | Likely pass; registry automation decides |
| Accurate non-marketing description | Candidate below is limited to demonstrated functions | Ready |
| npm mapping | npm `dsh-auto-memory-wh@1.0.1` reports repository `git+https://github.com/WanderingHeart/dsh-auto-memory-WH.git` | Pass |
| `dsh-plugin` topic | Unauthenticated GitHub REST API was rate-limited; the public repository page did not display a Topics section | **Unconfirmed; owner must verify/add before submission** |
| Current catalog entry | The expected raw path returned HTTP 404: `data/plugins/WanderingHeart__dsh-auto-memory-WH.yml` | Not listed |
| Final native Desktop evidence | Not rerun on this branch | Open release gate |

Expected catalog file URL checked (404 on 2026-11-17):

`https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/plugins/WanderingHeart__dsh-auto-memory-WH.yml`

## Candidate entry (do not submit yet)

```yaml
url: https://github.com/WanderingHeart/dsh-auto-memory-WH
name: WanderingHeart/dsh-auto-memory-WH
category: memory
description:
  en: Stores project and user-level memories as local Markdown, with bounded prompt injection, management UI, reversible merging, reminders, and backup/restore tools.
  zh: 将项目级与用户级记忆保存为本地 Markdown，并提供有界提示词注入、管理界面、可撤销合并、提醒及备份恢复工具。
```

The description avoids claims about automatic accuracy, complete privacy, secure deletion, universal compatibility, or verified two-device sync.

## Legacy index evidence

The earlier application [polang233/dsh-plugin-index issue #505](https://github.com/polang233/dsh-plugin-index/issues/505) was reported by the GitHub API as closed on 2026-11-16. That repository is not the catalog named by the current dsh-market README. Its closed issue does not establish inclusion in the current `awesome-dsh-plugin` registry.

## Submission procedure after gates pass

1. Verify/add the `dsh-plugin` GitHub topic.
2. Push this repository's final review branch, complete native Desktop acceptance, and resolve any findings.
3. Merge/release only through the owner's normal process; this audit does not do that.
4. Fork `awesome-dsh-plugin/awesome-dsh-plugin`.
5. Add only `data/plugins/WanderingHeart__dsh-auto-memory-WH.yml` with the reviewed content.
6. Optionally run `npm ci` and `node scripts/generate-readme.mjs` to preview, but do not manually edit generated README rows.
7. Open a separate listing PR and respond to the registry maintainer's source/accuracy review.

Exact current sources:

- Market submission routing: https://github.com/dsh-market/dsh-market#submit-your-plugin
- Registry: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
- Contribution requirements: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md
- Current catalog data directory: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/tree/main/data/plugins
- Legacy closed application: https://github.com/polang233/dsh-plugin-index/issues/505
