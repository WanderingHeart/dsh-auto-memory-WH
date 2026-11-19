# Changelog

## Unreleased

- Reuse per-record graph scoring inputs to reduce construction time without changing graph results.

- Use “DSH Memory” as the public display name, “Memory” (“记忆”) in the sidebar, and “Memory Library” (“记忆库”) for the management page. The npm package and plugin identity are unchanged.

- Keep the memory editor’s Save label white for legibility in the dark theme.

- Declare DSH `0.2.2-rc.4` and `0.2.2-rc.5` peers and align `agent/created` listeners with the newer event return contract. Test both candidates inside the existing Windows and Ubuntu CI jobs.
- Accept upstream takeover of locks owned by confirmed-dead processes. Retain offline recovery and test refusal for live or unrecognized lock owners. No memory format change.

- Clarify bilingual installation, configuration, privacy, backup/restore, uninstall/data-removal, troubleshooting, and compatibility boundaries for market review.
- Refresh upstream provenance and dependency-license documentation against the current repository and lockfile.
- Add a reproducible `npm run check` entry point and declare the audited npm version.
- Update the development test stack to patched Vitest/Vite releases; pin a compatible Rolldown patch after the newest native Windows binding failed validation.

## [1.0.1] — 2026-11-15

- Show only the three newest automatic merges inline.
- Add a floating, scrollable view of automatic and manual/historical merged memories in the selected scope, including merged content and existing automatic undo actions.
- Close the history popup with its close button, an outside click, or Escape.


## [1.0.0] — 2026-11-15

- Promote the verified rc.19 functionality to the first stable release: automatic project details and user-level summaries for all four memory types.
- Keep autoSummarize and enableUserScope enabled by default; explicit overrides remain supported.
- Add the tested DSH 0.2.2-rc.3 host services to peer declarations and update installation documentation and package metadata.
- No memory format or core runtime behavior changes from rc.19.

## [1.0.0-rc.19] - 2026-11-15

- 按所有者要求将 autoSummarize 默认值改为 true；enableUserScope 继续默认 true，显式 false 与 minimal 档限制仍生效。
- 同步 README、用户指南和配置说明，增加默认值及显式关闭回归；本候选尚未发布。


## [1.0.0-rc.18] - 2026-11-15

- 自动/手动会话总结同时保留项目详情和用户级简短概括，user/feedback/project/reference 四种类型均适用；沿用一次模型请求。
- memory_write 支持 userSummary，来源稳定关联、重复更新、跨项目隔离，并尊重用户作用域开关；概括不复制详情、证据原文或项目主题 id。
- 固化匹配限制在同一作用域，避免项目详情覆盖同名用户记忆；异常概括不阻塞详情持久化，日志/工具结果报告处理状态。
- 更新 README、用户指南与配置说明；增加双层记忆、异常和宿主总结触发回归。存储格式不变；保留 rc.17 回退路径。本候选尚未正式发布。


## [1.0.0-rc.17] — 2026-11-09

### Changed

- 取消 rc.16 的“点记忆卡片/列表空白退出编辑器”——实测误触多于便利；保留行内“查看 / 编辑：取消”按钮。

### Verification

- 60 test files, 630 tests passed; typecheck clean; isolated acceptance 22/22; desktop rc.16→rc.17 7/7.

## [1.0.0-rc.16] — 2026-11-09

### Added

- 记忆编辑器打开后，原“查看 / 编辑”按钮变为“查看 / 编辑：取消”，点它即可收起编辑器。
- 点记忆卡片的空白处或列表卡片之间的空白，也会收起当前编辑器。

### Verification

- 60 test files, 630 tests passed; typecheck clean; isolated acceptance 22/22; desktop rc.15→rc.16 7/7.

## [1.0.0-rc.15] — 2026-11-09

### Fixed

- 面板“导出 JSON 包”改用 POST 请求；此前误用 GET，命中只接受 POST 的路由，导出总是报“宿主返回了无法识别的响应”。
- “移至归档”的确认改为行内显示（“确认归档 / 取消”）；此前确认区渲染在列表底部，看起来像没有反应。

### Verification

- 60 test files, 629 tests passed; typecheck clean; isolated acceptance 22/22; desktop rc.14→rc.15 7/7.

## [1.0.0-rc.14] — 2026-11-09

### Changed

- 合并操作去掉二次确认：点“确认合并（N 组）”或“合并这一组”即执行，来源仍标记为被取代、可撤销；结果行继续保留在列表上方。

### Verification

- 60 test files, 628 tests passed; typecheck clean; isolated acceptance 22/22; desktop rc.13→rc.14 7/7.

## [1.0.0-rc.13] — 2026-11-09

### Fixed

- 重复扫描（`memory.duplicates`）与主题簇扫描（`memory.mergeSuggest`）跳过已取代/停用记录，避免把已被取代的成员再次列入合并组。
- 批量合并遇到已失效、已停用或缺失的来源时改为跳过并在结果里报告，不再 409 中断整批；组列表收起后仍显示“已合并 / 已跳过”的结果行。

### Verification

- 60 test files, 627 tests passed; typecheck clean; isolated acceptance 22/22; desktop rc.12→rc.13 7/7.

## [1.0.0-rc.12] — 2026-11-09

### Changed

- 词面相关性增强：高置信同义词归一（考研/研究生考试、发布/release、合并/merge 等），连字符/下划线名称按子词再切分。
- 面板的自动合并与待确认列表优先显示中文标题（没有标题时才回落记录名）。

### Verification

- 60 test files, 623 tests passed; typecheck clean; isolated acceptance 22/22; desktop rc.11→rc.12 7/7.

## [1.0.0-rc.11] — 2026-11-09

### Changed

- 自动合并触发条件改为：同主题且相关 ≥60% 自动合并；同主题或相关任一 ≥60% 只进面板“待确认”；两者都不达标不处理。candidate 记录同样参与扫描。
- 导入/同步的冲突判定不再要求“已审核”：内容不同且本地更新不早于远端即为冲突，只有远端严格更新才覆盖；删除分支同样按时间比较。
- 质量体检的过期提示改名为 `stale-record`，对 candidate/legacy 也生效（disputed/superseded/停用除外）。

### Fixed

- 撤销审核后遗留的 `verified` 门槛：自动合并、导入冲突、同步冲突与质量提示对 candidate 记录失效的问题。

### Verification

- 60 文件 621/621、隔离 22/22、桌面 rc.10→rc.11 7/7。

## [1.0.0-rc.10] — 2026-11-09

### Changed

- 撤销“用户审核”环节：candidate/legacy 记录直接参与注入，只有 disputed、superseded、停用或过期的记录被排除；面板移除批量审核与“未审核”筛选，状态文案改为“自动记录 / 已确认 / 旧记录 / 有争议 / 已取代”。
- 合并与跨端 fork 不再产生“待审核”语义；导入/同步冲突文案改为“跳过 / 两边都留”。
- 总结浮层把路径型会话标题显示为“未命名会话 · 项目名”。

### Fixed

- 拖入非 WH 记忆包（例如只有“111”三个字符）时不再静默：先提示“文件不是有效的 JSON”，再提示“文件里没有 records 列表”。
- 用户指南、发布说明、架构/配置/质量文档去掉审核描述；新增 `docs/attachments/release.md`。

### Verification

- 60 test files, 618/618 unit tests; isolated acceptance 22/22; desktop rc.9 → rc.10 7/7.

## [1.0.0-rc.9] — 2026-11-09

### Added

- 面板导入支持拖拽：把 JSON 包拖到面板任意位置即可预演，松开后进入只读预览。
- 导入预览显示包体积与记录数；单文件超过 2 MB 直接提示拆包，不进入预演。

### Verification

- 60 test files, 616/616 unit tests; isolated acceptance 22/22; desktop rc.8 → rc.9 7/7.

## [1.0.0-rc.8] — 2026-11-09

### Added

- memory_reminders: read-only list of reminders created by the plugin, with localTime rendered in the user machine time zone plus the IANA timeZone id; host schedule_list formatting is untouched.

### Verification

- 60 test files, 614/614 unit tests; isolated acceptance 22/22; desktop rc.7 → rc.8 7/7.

## [1.0.0-rc.7] — 2026-11-09

### Added

- 面板支持 JSON 包导出与导入：导出带校验和的 `wh-memory-export` 包；导入先只读预演（新增/更新/相同/冲突），再选择冲突策略。
- 冲突策略二选一：保留本地（跳过远端）或两边都留（远端版本存为待审核候选，名称确定且可重复导入幂等）。

### Verification

- 60 个测试文件 612/612 通过；隔离验收 22/22；桌面 rc.6→rc.7 7/7。

## [1.0.0-rc.6] — 2026-11-09

### Added
- 跨端主题字段：导出包（wh-memory-export v1）与同步变更集（wh-sync-changeset v1）现在携带 topic 并原样写回；旧包/旧端点缺省即“未归类”，不丢正文。
- 冲突“保留双方”：import.apply 与 sync.apply 支持 onConflict: "fork"——本地已审核记录不动，远端内容另存为可审核的 <name>-shared-<指纹6位> 候选；副本名确定且幂等。API、maintenance-cli 的 sync-pull / sync-apply 均可选用。

### Verification
- 单测：60 文件 611/611 通过；tsc --noEmit 通过。
- 隔离验收：22/22（typecheck/build/unit/distribution/license/storage/host 全套）。
- 桌面升级：rc.5 → rc.6，7/7。

## [1.0.0-rc.5] — 2026-11-09

### Added
- 提醒落点的相关性路由（roadmap 1.3 首刀）：`memory_remind` 默认投递本会话；提醒文字明确命中另一个已知项目时改投该项目 `cwd` 的一次性新会话；同时命中本会话与其他项目、或命中多个项目时**不创建**，返回 `needsConfirmation` 问题，模型询问后用 `route=current` / `route=new` 重试。新增 `src/reminder-routing.ts`；`newSession` 保留为兼容别名。
- 关闭/重开补投的插件侧覆盖：到期后 30 分钟宽限内重开仍由 `listDueReminders` 返回（宿主实际投递仍需桌面演练）。

### Verification
- Unit: 60 files, 605/605.
- Isolated acceptance: 22/22.
- Desktop upgrade rc.4 → rc.5: 7/7.

## [1.0.0-rc.4] — 2026-11-09

### Changed

- 自动合并（同主题）门槛从 80% 降到 60%：同主题且相关性 ≥60% 直接自动合并，仍只处理“已审核 + 有主题 + 非任务/置顶/禁用”的记录，可撤销；跨主题仍只在 ≥80% 时进入面板待确认队列。
- 面板文案与 `docs/configuration.md` 同步新门槛；`ASK_MERGE_SCORE` 由 `CROSS_TOPIC_ASK_SCORE = 80` 取代。

### Verification

- 59 个测试文件 596/596 通过；隔离 `wh-s05` 22/22；桌面 1.0.0-rc.3 → 1.0.0-rc.4 升级 7/7。

## [1.0.0-rc.3] — 2026-11-09

### Added

- 人物弧光（roadmap 1.7 P3，只读）：新增 `arc.view` 管理 API，把用户层与全部项目 scope 的记忆按主题成章、章内按时间排序，串成一条可追溯的叙事线；章序以主题注册表为准，未登记主题按名称排序，未归类最后。
- 面板工具栏新增“人物弧光”入口（与关系图并列，仅全功能档可见）：显示篇章数/条数/来源，条目带日期、来源项目、信任状态与取代关系，点击条目跳回该记忆；全程只读，不改写、不合并、不改信任。
- `arc.view` 不返回正文，只返回定位与时间/状态字段；解析失败的文件计入 skipped 并在面板提示，超过 2000 条截断并提示。

### Verification

- 59 个测试文件 594/594 通过；隔离 `wh-s05` 22/22；桌面 1.0.0-rc.2 → 1.0.0-rc.3 升级 7/7。

## [1.0.0-rc.2] — 2026-11-09

### Added

- 主题大类（topic）：每个 scope 一份 `topics.json` 注册表，记录带 `topic` 字段；`memory_write`、`memory_patch` 与管理 API 可指定，自动总结写入时按注册表做词面匹配兜底，未命中记为“未归类”待人工调整。
- 迁移脚本把现有记忆全部归类（本机 21 条：记忆插件 15、考研 3、身份 1、项目经历 1、协作方式 1），缺省未归类的旧记录不再出现。
- 自动合并：同主题且相关性 ≥80% 自动合并（来源标记为被取代、结果继承已审核），同主题 ≥60% 进入面板待确认，跨主题高相关只询问；撤销账本保留最近 100 条，撤销即恢复来源。

### Changed

- 记录列表显示“主题：X”；“重复与合并”页新增自动合并区块（立即合并、待确认、撤销）。
- 自动合并默认开启（`autoMerge: true`），只在 `merge` 功能档可用时生效，启动 20 秒后与会话固化后各对账一次。

### Verification

- 57 个测试文件 579/579 通过；隔离 `wh-s05` 22/22；桌面 1.0.0-rc.1 → 1.0.0-rc.2 升级 7/7。

## [1.0.0-rc.1] — 2026-11-08

首个公开发布候选。相对 0.12.7 只改版本号与发布材料，不引入功能变更。

### Highlights

- 任务提醒交还宿主原生；装了 `dsh-whale-widget` 时小鲸鱼气泡 + 提示音。
- 面板工具栏“总结”：列最近活跃会话（最多 3 个，显示会话标题与未固化行数），一点即整理成待审候选；会话闲置 1 小时自动触发一次。
- 关系图（只读 3D 投影）、三档版本分级与运行时切换（`settings.json`）、质量体检与相关记忆。
- 自托管 `wh-sync-relay` 传输层；面板与深色主题持续打磨。

### Verification

- 54 个测试文件 564/564 通过；`tsc` 0。
- 隔离 `wh-s05` 22 步通过；`release-readiness.mjs` 12/12 READY；桌面 0.12.7 → 1.0.0-rc.1 升级 7/7 通过。
- 候选包 182,073 字节 / SHA-256 `f0c690fb…14e0` / `lib` `2a4105d7…5066`。

## [0.12.7] — 2026-11-08

### Changed

- “总结”浮层的候选会话改为显示会话标题：取该会话第一条真实用户输入的首行（最长 24 字，超出以“…”结尾），不再把完整工作区路径当作主标签；路径保留在悬停提示里。
- 修复候选行在按钮内被水平居中的问题，标题与“N 行未固化”改为左对齐。

### Verification

- 54 个测试文件 564/564 通过（更新会话标题与左对齐断言）；隔离 `wh-s05` 22/22；桌面升级 0.12.6 → 0.12.7 通过。

## [0.12.6] — 2026-11-08

### Fixed

- “总结”浮层的候选会话不再依赖插件内的事件缓冲：直接读取宿主 `sessions` 服务里仍在内存的会话日志（`session.snapshotEvents()`）重建对话，插件晚于会话恢复加载、或 `session/event` 未送达时也能列出最近活跃会话。
- 会话列表与立即总结都走同一条重建路径：手动总结同样读取会话日志，只对“尚未固化”的行调用模型。
- 空状态诊断改为“内存中 N 个会话、M 个有模型路由、K 个活跃代理”，对应新的会话来源。
- “总结”浮层内的刷新按钮改为与工具栏一致的图标按钮（`aria-label="刷新总结会话"`）。

### Verification

- 54 个测试文件 564/564 通过（新增“无任何 session/event 时也能从会话服务列出并总结”用例）；隔离 `wh-s05` 22/22；桌面升级 0.12.5 → 0.12.6 通过。

## [0.12.5] — 2026-11-08

### Fixed

- “总结”浮层不再在宿主注册表对未知会话抛错时返回 `IO_ERROR`：路由解析对注册表异常容错，诊断计数同样容错。
- 候选会话的路由来源增加会话请求头：插件晚于会话恢复加载时，从 `request/header` 事件与 `session.requestHeader()` 取 provider/model，不再只依赖 `agent/created`。
- 子代理会话不再进入“最近活跃会话”候选列表。
- management API 的兜底错误会把真实异常写入宿主日志，面板仍显示通用文案。

### Added

- “总结”浮层增加“刷新”按钮；每次打开浮层都会重新读取候选会话。

### Verification

- 54 个测试文件 562/562 通过；隔离 `wh-s05` 22/22；桌面升级 7/7（2026-11-08）。

## [0.12.4] — 2026-11-08

### Fixed

- 工具栏浮层互斥：打开"总结"或"档位"后点其它按钮/空白处会先收起旧浮层，不再出现两个浮层重叠。
- 闲置触发的"总结"浮层在插件晚于会话恢复加载时也能列出候选会话：路由缺失时从宿主 agent 注册表补取 provider/model，而不是只依赖 `agent/created`。
- 空状态显示进程内诊断计数（捕获会话数/有路由数/活跃代理数），便于区分"没有缓冲""没有路由""没有活跃会话"。

### Verification

- 54 个测试文件 561/561 通过；隔离 `wh-s05` 22 步 22/22；桌面升级 7/7（21 条用户记忆不变）。

## [0.12.3] — 2026-11-08

### Added

- 自动总结新增“闲置触发”：根会话连续 60 分钟没有新事件（会话可以一直开着）就整理一次尚未固化的对话；任何新事件都会重新计时，同一闲置窗口只跑一次。新增配置 `autoSummarizeIdleMinutes`（0–1440，0 表示仍只在会话结束时触发）。
- 面板工具栏新增“总结”：列出最近活跃、有未固化内容的 3 个会话，点一个即可立即总结；跳过等待但仍过门槛，结果按“已写入 / 还太短 / 没有新内容 / 模型失败”给出提示。

### Changed

- 存储抽屉文案改为“已开启，闲置一小时触发一次”（按 `autoSummarizeIdleMinutes` 格式化）。

### Verification

- `tsc --noEmit` 0；54 个测试文件 / 559 用例通过（新增闲置触发 4 例、路由 2 例、面板浮层 1 例）。
- 隔离 `wh-s05` 22/22 通过；日常桌面升级 7/7 通过（版本 0.12.3、`lib` sha256 匹配、21 条记录不变）。

## [0.12.2] — 2026-11-08

### Added

- 面板“存储”抽屉新增“自动总结”状态：本进程运行次数、最近一次的时间与结果、写入候选数、跳过数与累计写入量。只统计数量，不保存对话内容。
- 自动固化在跳过（门槛）、截断（max_tokens）、解析失败、模型失败与写入完成时记录运行摘要，便于判断 autoSummarize 是否值得继续开启。

### Verification

- `tsc --noEmit` 0；53 个测试文件 / 551 用例通过（新增运行摘要 4 例、面板展示 1 例）。
- 隔离 `wh-s05` 22/22（含 `edition-matrix` 与 `runtime-license-audit`）；桌面升级 7/7，21 条记录与 9 个 bundle 保留。

## [0.12.1] — 2026-11-08

### Added

- 工具栏“档位”按钮：点开后是低 / 中 / 高三档滑条，拖动即切换，切换后立刻刷新面板并隐藏被关闭的入口。
- 运行时档位切换：新增 `edition.set`（POST），把所选档位持久化到 `<记忆根>/settings.json`，之后每次加载都以该文件为覆盖值；未实现切换的老宿主返回 `EDITION_DISABLED`。
- 档位变化即时生效：API 门禁、`memory_remind` 注册与自动备份都按当前内存档位判断，不需要重启。

### Verification

- `tsc --noEmit` 0；52 个测试文件 / 547 用例通过（新增设置持久化 3 例、运行时切换 2 例、面板滑条 1 例）。
- 隔离 `wh-s05` 21/21；桌面升级 7/7（21 条记录，记忆摘要 `6bf45fd9…43fb` 前后不变）。

## [0.12.0] — 2026-11-08

### Added

- 版本分级（roadmap 1.5）：`edition` 配置项支持 `minimal` / `standard` / `full` 三档，默认 `full`。
  - 三档共用同一份 `memory-wh` 存储与同一套审核/信任语义，只影响注入预算建议、可选功能与后台任务。
  - 低功能档不注册 `memory_remind`，关闭自动固化、备份、近重复与合并、导入导出、迁移检查与批量审核。
  - 中功能档启用提醒、自动固化、备份、合并、导入导出与迁移，不含关系图与批量操作。
  - API 侧对未启用功能返回 `EDITION_DISABLED`（403）；面板隐藏对应入口，并在“存储”面板显示当前档位。

### Verification

- `tsc --noEmit` 0；51 个测试文件 / 541 用例通过（新增版本分级纯函数与 API 门禁 7 例、面板隐藏与档位标签 2 例、配置校验 1 例）。

## [0.11.0] — 2026-11-08

### Added

- 长轮次完成通知：宿主侧监听 `agent/status`，只记录运行时长达到阈值的轮次，通过只读 `completion.pending` 馈送；客户端每 15 秒轮询，用小鲸鱼气泡 + 提示音告知“这一轮跑完了”，sessionStorage 去重，没装小鲸鱼时静默。
- 配置项 `notifyDone`（默认开启）与 `notifyDoneMinSeconds`（默认 60，范围 10–3600）。

### Verification

- `tsc --noEmit` 0；50 个测试文件 / 531 用例通过（新增宿主跟踪器 8 例、客户端通知 11 例、API 3 例）。
- 隔离 `wh-s05` 21/21；桌面升级脚本 7/7。

## [0.10.1] — 2026-11-08

### Changed

- “关系图”从设置菜单移到工具栏，与“新建 / 未审核 / 重复与合并 / 筛选”并列。
- 深色主题细化：面板底色与卡片层级、设置菜单/抽屉/筛选弹层的阴影与边框、进度条颜色、次要文字对比度、输入框与按钮的底色都做了深色适配。

### Verification

- `tsc --noEmit` 0；48 个测试文件 / 509 用例通过（关系图入口改到工具栏后仍有一条用例覆盖点击与请求）。
- 隔离 `wh-s05` 21/21；桌面升级脚本 7/7。

## [0.10.0] — 2026-11-08

### Added

- 关系图（设置 → 关系图）：自绘轻量 3D 投影，无第三方依赖。节点按类型分层、按类型着色，边来自现有相关性评分；拖拽旋转、滚轮缩放、点击节点跳到该条记忆；只读，不改动任何记忆。
- `relatedness.graph` 只读接口：一次返回当前范围的节点、边与阈值（默认 30 分、每节点最多 6 条边）。

### Verification

- `tsc --noEmit` 0；48 个测试文件 / 509 用例通过（新增 `tests/graph.spec.ts` 13 例、`relatedness.graph` 1 例、面板 1 例）。
- 隔离 `wh-s05` 21/21；桌面升级脚本 7/7。

## [0.9.1] — 2026-11-08

### Fixed

- 小鲸鱼气泡漏报：一次性提醒触发后宿主任务立刻变成 `ended`，而 `tasks.due` 只列 `active` 任务，客户端轮询永远看不到。改为列出最近任务并按 `scheduledAt` 窗口过滤，仅跳过 `paused`/`inactive`；一次性提醒触发后 30 秒内会被气泡补上。
- 测试补了“触发后仍进入到期列表”的语义（paused 任务用 `status: 'paused'` 表达）。

### Verification

- `tsc --noEmit` 0；`vitest run` 47 文件 / 494 用例通过。

## [0.9.0] — 2026-11-08

### Changed

- 任务提醒改为宿主原生能力：记忆不再保存任务，也不再渲染任务注入段。
  - 新增 `memory_remind` 工具：直接调用宿主 `schedule` 服务创建提醒，默认投递当前会话，可 `newSession`。
  - `memory_write` 不再接受 `type: 'task'`（schema 直接拒绝）；面板移除任务字段、任务按钮与任务类型。
  - 小鲸鱼气泡的数据源 `tasks.due` 改为读取原生调度（标题带 `记忆提醒：` 且正文带 `[memory-wh] reminder` 标记）。
  - 删除调度桥接（`src/schedule-bridge.ts`、sidecar、对账定时器）与记忆任务注入段；面板“存储”里的调度状态改为“已连接（任务提醒走原生‘自动化任务’）”。
- 旧任务记忆迁移：user scope 中 1 条遗留任务已版本化归档，证据 `docs/evidence/S05-v090/task-migration.json`。
- 协议保持加法兼容：同步与导入导出仍能读取旧 `type: 'task'` 记录（只读兼容），但新建不再产生。

### Verification

- `tsc --noEmit` 0；`vitest run` 47 文件 / 494 用例通过。
- 完整构建与候选包在本条之后生成。

此文件固定放在项目根目录，记录 **dsh-auto-memory-WH 自身**的版本更新。
每阶段实现讲解固定放在 [docs/progress/](docs/progress/README.md)。
原上游版本历史完整保存在 [docs/upstream/CHANGELOG.md](docs/upstream/CHANGELOG.md)。

## [0.8.10] — 2026-11-08

### Changed

- 筛选弹出层去掉可见的“类型”文字标签（保留无障碍名称），白框改为按内容收紧，不再是一整条长条。

### Verification

- `tsc --noEmit` 通过；47 个测试文件、507 个用例通过。
- 隔离 `wh-s05` 21/21 通过；桌面 profile 升级到 0.8.10。

## [0.8.9] — 2026-11-08

### Changed

- 工具栏拆出独立的“未审核”同键折叠按钮（“未审核 / 未审核：收起”），状态筛选从筛选弹出层移除，筛选只保留类型。
- “新建”在同一位置切换为“新增：取消”，点击后完全丢弃草稿；未审核、新增、筛选、重复与合并、搜索、设置、面板统一支持 Esc 收起。
- 筛选弹出层支持点击空白处关闭，与设置菜单一致。
- 编辑器里的摘要与正文默认收为单行高度（38px），聚焦时展开（最高 320px）；列表卡片摘要单行省略。
- 移除“静音”按钮（底层 `disabled` 字段保留，仅用于兼容旧数据与索引排除）。
- 页面标题改为 30px / 700 / 字距 -0.03em，与大标题风格对齐。

### Verification

- `tsc --noEmit` 通过；47 个测试文件、507 个用例通过（面板 42 例）。
- 隔离 `wh-s05` 21/21 通过；桌面 profile 升级到 0.8.9。

## [0.8.8] — 2026-11-08

### Changed

- 设置菜单不再在打开功能面板时收起：面板悬浮在菜单左侧，与菜单并列，像右键子菜单（`drawerRight = 菜单宽度 + 62px`；窄于 760px 时退回整宽）。
- 点空白处仍同时关闭菜单与面板；Esc 关闭两者；点菜单或面板内部保持打开。

### Verification

- `tsc --noEmit` 通过；47 个测试文件、504 个用例通过（面板 39 例）。
- 隔离 `wh-s05` 21/21 通过；桌面 profile 升级到 0.8.8（详见 `docs/progress/2026-11-08_019_·_v0.8.8_设置菜单常驻与功能面板并列悬浮.md`）。

## [0.8.7] — 2026-11-08

### Changed

- 面板背景灰度再降低约三成（`color-mix` 混入比例 10% → 7%），更接近宿主品牌浅色面。
- 设置菜单与功能抽屉改为悬浮在右上角齿轮左侧（`right: 52px`），不再贴在齿轮正下方，也不再贴界面左端；外观保持圆角浮层。

### Verification

- `tsc --noEmit` 通过；47 个测试文件、503 个用例通过。
- 隔离 `wh-s05` 21/21 通过；桌面 profile 升级到 0.8.7（详见 `docs/progress/2026-11-08_018_·_v0.8.7_面板灰度回调与设置悬浮位.md`）。

## [0.8.6] — 2026-11-08

### Changed

- 设置里的功能面板不再固定在页面最左端，改为锚定在页头右上角、从设置按钮下方展开；内容多高就多高（最高 70vh），短内容不再拉成整列。
- 设置菜单、功能面板都支持点击面板外任意位置或按 Esc 关闭，右上角的叉保留。
- 面板背景再加深一档（基础表面混入 10% 正文色），记录卡片加极轻投影。

### Verification

- `tsc --noEmit` 0；47 个测试文件 / 503 用例通过；新增“抽屉锚定页头并点外部关闭”“设置菜单点外部关闭”两个用例。
- 隔离 `wh-s05` 21 步全部通过（候选 166,073 字节 / `6FAB5024…F3DB`、`lib` `410065F8…5726`，r168）。
- 日常桌面已升级到 0.8.6：7/7 检查通过、记忆摘要前后一致、22 条记录、9 bundles 保留，待重启确认。

## [0.8.5] — 2026-11-08

### Changed

- 面板背景由“次级表面色”改为在基础表面上按 10% 混入正文色，深度接近“上下文洞察”页面；记录卡片增加极轻的投影，层次更清楚。
- 背景使用 `color-mix` 并由 `@supports` 兜底，旧内核仍退回次级表面色；深色模式同样加深。

### Verification

- `tsc --noEmit` 0；47 个测试文件 / 501 用例通过。
- 隔离 `wh-s05` 21 步全部通过（候选 165,507 字节 / `42676730…EAA5`、`lib` `9F4E5E39…3030`，r167）。
- 日常桌面已安装 0.8.5：记录模式 6/6 检查通过、`lib` 哈希一致、22 条记录、9 bundles 保留，待重启确认。

## [0.8.4] — 2026-11-08

### Changed

- 记忆面板背景改用次级表面色，与页面形成更明显的层次区分，卡片边界更清楚。
- “重复与合并”展开后不再出现单独的“收起”按钮，同一按钮显示为“重复与合并：收起”，点击即收起。

### Verification

- `tsc --noEmit` 0；47 个测试文件 / 501 用例通过；新增“同一按钮收起合并区”的用例。
- 隔离 `wh-s05` 21 步全部通过（候选 165,245 字节 / `DE332AC8…AF15`、`lib` `954E7B7B…63BE`，r166）。
- 日常桌面已升级到 0.8.4，7/7 检查通过、记忆摘要 `2FAD89A8…ED97` 前后一致、22 条记录、9 bundles 保留，待重启确认。

## [0.8.3] — 2026-11-08

### Changed

- 记忆编辑器只保留「保存」「取消」：保存即表示已阅读并确认允许自动使用，去掉单独的审核勾选框与“将已保存版本标为争议”按钮。
- 列表默认隐藏“已取代”记录；需要查看时仍可在状态筛选中选择“已取代”。

### Verification

- `tsc --noEmit` 0；47 个测试文件 / 500 用例通过；新增“默认列表隐藏已取代、按状态筛选可查看”的接口用例。
- 隔离 `wh-s05` 21 步全部通过（候选 165,039 字节 / `9D810C5E…3E61`、`lib` `1566DBE9…D493`，r165）。
- 日常桌面已升级到 0.8.3，7/7 检查通过、记忆摘要前后一致（`1969B909…F889`）、22 条记录、9 bundles 保留，待重启确认。

## [0.8.2] — 2026-11-08

### Changed

- 面板继续收敛：页头只保留标题；刷新、搜索、设置固定在右上角且不再换行。
- 搜索改为放大镜图标，点击向左展开输入框，平时隐藏；Esc 关闭。
- 状态与类型筛选收进“筛选”弹出层，与“新建 / 重复与合并”并列。
- 设置项不再堆在页面底部：存储、归档、组装审计、运行指标、质量体检、迁移检查改为左侧悬浮抽屉。
- 编辑器标题只保留“编辑”，删除草稿说明与纯文本预览块。
- 相关记忆只保留百分比进度条与结论，不再展示打分明细。

### Verification

- `tsc --noEmit` 0；47 个测试文件 / 499 用例通过；面板新增搜索展开、筛选弹出层、抽屉、编辑标题与无预览块等用例。
- 隔离 `wh-s05` 21 步全部通过（候选 165,062 字节 / `C7464929…9BFF`、`lib` `9D20E323…3BC4`，r163）。
- 日常桌面已升级到 0.8.2（r164），7/7 检查通过、记忆摘要前后一致、22 条记录、9 bundles 保留，待重启确认。

## [0.8.1] — 2026-11-08

### Added

- “相关记忆”区改用百分比进度条（`相关度 N%`），与“重复与合并”的相似度呈现一致。

### Changed

- 键盘可达：按钮、输入框、下拉、摘要与链接统一显示 `:focus-visible` 焦点环。
- 窄窗口（≤720px）：页头动作换行、设置菜单限制在屏宽内、进度条铺满、合并卡片可横向滚动。
- 深色与减少动效：设置菜单阴影适配深色，`prefers-reduced-motion` 下关闭过渡动画。

### Verification

- tsc --noEmit 0；47 个测试文件 / 495 用例通过；相关记忆进度条与焦点环样式随面板测试验证。
- 隔离 `wh-s05` 21 步全部通过（候选 163,949 字节 / `E5BC1D12…BEE3`、`lib` `8B92DC00…8998`，r161）。
- 日常桌面已升级到 0.8.1（r162），7/7 检查通过、记忆摘要前后一致、22 条记录、9 bundles 保留，待重启目视确认。


### Changed

- 面板工具栏收敛：顶部只保留“新建”、刷新图标与设置图标；归档、组装审计、运行指标、质量体检、立即备份、两种导出与迁移检查收进“设置”菜单。
- “查找近重复”与“合并建议”合并为“重复与合并”，结果显示在工具栏下方；相似度用百分比进度条呈现。
- 合并流程从“预览 → 确认”简化为一次“确认合并”；相似度 ≥80% 的组默认勾选，可手动取消，确认后批量合并为待审核记录（来源可恢复）。

### Fixed

- 质量体检的多标题提示已按 ≤4 个二级标题重写；两条项目记忆补齐标题，当前体检 flagged 0。

### Verification

- tsc --noEmit 0；47 个测试文件 / 495 用例通过；面板测试覆盖图标按钮、设置菜单、合并进度条与单步确认。
- 隔离 `wh-s05` 21 步全部通过（候选 163,151 字节 / `32AD49FA…94A4`、`lib` `EDFD28AB…5437`，r159）。
- 日常桌面已升级到 0.8.0：7/7 检查通过、记忆摘要前后一致、22 条记录、9 bundles 保留（r160），待完全重启验证界面。

## [0.7.0] — 2026-11-08

### Added

- 小鲸鱼气泡提醒（可选）：只读接口 `tasks.due` + 客户端适配器 `src/client/whale-notify.ts`。检测到 `window.__dshWhaleNotify` 时，每 30 秒或页面重新可见时拉取到期任务，气泡常驻（`ttlMs: 0`）并可播放挂件自带的“任务结束音”；未装小鲸鱼、钩子抛错或宿主关闭通道时静默降级为“宿主投递 + 会话内注入”，不影响原提醒链路。
- 提醒去重：`sessionStorage` 按 `scope:name@提醒时刻` 记 24 小时，同一任务同一时刻只弹一次；改期会得到新签名并再次提醒。
- 相关性（只读）：`relatedness.forRecord` 与管理面板“相关记忆”区。按共享词（英文词 + 中文二元组）、显式 `[[name]]` 引用、同项目、同类型/作用域、时间邻近打分并列出理由；阈值 30（弱）/60（强），最多 5 条。只展示，不合并、不 supersede、不写盘。
- 新配置 `notifyWhale: 'auto' | 'off'`，默认 `auto`。

### Changed

- 面板打开记录编辑器时并行加载相关记忆；相关性请求失败不影响编辑与保存。
- 记录编辑器改为在对应记忆条目内部展开（不再固定渲染在整页最下方）；新建记录仍显示在列表上方，正在编辑的记录不在当前页时回退到列表下方。

### Verification

- `tsc --noEmit` 0；47 个测试文件 / 494 用例通过（新增 `tasks-due`、`whale-notify`、`relatedness` 与面板相关区用例）。
- 隔离 `wh-s05` 21 步全部通过（候选 161,477 字节 / `12EC4B0F…B4F09E`、`lib` `380348DD…4842`，r156）。
- 日常桌面已升级到 0.7.0：7/7 检查通过、记忆摘要前后一致、20 条记录、9 bundles 保留（r157）；已完全重启；面板内联编辑器、相关记忆与定向提醒均已实测通过（r158）。

## [0.6.0] — 2026-11-08

### Added

- 质量体检（只读）：`quality.report` API 与管理面板“质量体检”按钮，按记录列出 `description-long`/`body-short`/`name-generic`/`title-missing`/`task-missing-due`/`task-overdue`/`verified-stale`/`body-many-sections` 八类提示与建议；阈值集中在 `src/quality.ts`。
- 检索可解释：`memory_search` 返回 `matchedIn`（name/title/description/body），说明“为什么召回这条”。
- 质量体检显示索引占用：`index.bytes/budget/excluded`（由宿主渲染真实索引后注入），超预算时提示注入会被截断；可展开查看被排除的记录与原因。
- 质量体检返回近重复组数（阈值 0.8），面板给出“用查找近重复逐组处理”的固定入口；不自动合并。
- autoSummarize 价值门槛：候选名为 `notes/todo/misc` 等通用名时直接丢弃（记入 `tally.lowQuality`），避免不可检索的自动记忆。
- 写入口径文档 `docs/attachments/memory-quality.md`：规则分层、一条一决策、什么不值得写、复查节奏与度量基线。
- 度量基线脚本 `scripts/verification/quality-baseline.mjs` 与首次基线 `docs/evidence/S05-v060-quality/baseline.json`（19 条、flagged 5、近重复 1 组、索引 3558/4096）。

### Changed

- 任务型记录（`type: task`）不参与质量体检的“正文过短/多标题”提示；已完成/已取消的任务不再提示截止与逾期。
- 管理面板每页 5 条（原 25 条），翻页按钮与页码同步改用 `PAGE_SIZE`。
- 面板定时刷新/手动刷新不再清空列表，只更新数据；页面不再因列表卸载而变矮，滚动位置不会被夹回顶部。切范围、查询、筛选或翻页时仍清空并回到新列表。
- 宿主提醒投递按任务所属项目指定工作区：项目任务的 `new_once` 投递带 `create.cwd`，新会话落在对应工作区而不是 profile 目录（修复 `未分组`）；user 作用域任务保持宿主默认。工作区变化时删除并重建宿主任务（目标不可原地改），`schedule-bridge.json` 记录 `cwd`。

### Verification

- `tsc --noEmit` 通过；`vitest run` **44 文件 / 461 用例**通过（2026-11-07）。
- 首次度量基线采集成功（真实记忆根，只读）。
- 质量体检不修改记录：API 用例断言 revision 不变，面板用例断言未调用 `memory.write`。
- 候选包 `.work/dsh-auto-memory-wh-0.6.0.tgz`（155,405 字节 / `83B169B915D797CCBE3582DA24F01ECC1B67DDC5A209B4B417D93D648445863C`，`lib/index.js` `2631A0E6…3A8F`）。
- 桌面重启后确认运行 `0.6.0`（`lib` `2631A0E6…3A8F`、203,237 字节）；`notifySessionId` 定向投递实测成功（调度器按 `target: session` 投递进创建任务的会话）；见 [r155](docs/progress/2026-11-08_004_2026-11-08_S05_v0.6.0_收尾：重启生效、定向投递与未分组清理.md)。
- 隔离 profile `wh-s05` 21/21 通过（r150、r154）；宿主探针 `installedVersion 0.6.0` 且 bundle 哈希一致。
- 最终验收（r154）：候选 155,405 字节 / `83B169B9…863C`、`lib/index.js` 203,237 字节 / `2631A0E6…3A8F`；44 文件 461/461；面板每页 5 条/刷新不卸载/质量体检内联通过；基线复采 flagged 5 → 1、索引 3645/4096。
- 日常 `desktop` 0.5.2 → 0.6.0 升级：7/7 检查通过、记忆摘要不变、20 条 user scope 记录、9 bundles 保留；需重启 DSH 生效（r151）。

## [0.5.2] — 2026-11-07

### Changed
- 任务一变立即对账：任务写入、审核通过、标记完成（归档删除）或删除，经模型工具或管理 API 成功后立即触发一次调度桥接对账（`onTaskChange` 回调；reconcile 增加并发守卫，避免重叠执行）。
- 真实桌面发现的滞后：0.5.1 上任务创建到宿主 `schedule.json` 落位约 3 分钟（20:07:25 创建 → 20:10:27 落位，对账只有启动 +10s、每 5 分钟、`agent/created` 60s 节流三种触发），提前完成的任务仍可能被提醒；0.5.2 把“完成 → 宿主任务清空”的时延从最长约 5 分钟降到秒级。

### Verification
- `tsc --noEmit` 0；`vitest` 43 文件 / 442 用例通过（新增 2 项对账钩子用例，覆盖工具与 API 两条路径）。
- 候选包 `.work/dsh-auto-memory-wh-0.5.2.tgz`：149,348 字节 / `5523…0101`；`lib/index.js` `AB8A…8FC6`（194,988 字节）；隔离 `wh-s05` 21 步全部通过（`docs/evidence/S05-0.5.2-acceptance/summary.json`，宿主探针 `installedVersion 0.5.2`、bundle 哈希一致）。
- 日常 `desktop` 由 0.5.1 升级到 0.5.2（证据 `docs/evidence/S05-real-data-migration/desktop-upgrade-0.5.2.json`：7/7 检查通过、记忆摘要 `3fb2aaf7…` 前后一致、20 条 user scope 记录、9 bundles 保留）；重启后已在面板点击“标记完成”验证：归档写入到宿主 tasks 清空约 50 ms，完成时刻距到期 18 分 25 秒（证据 [`desktop-complete-reconcile.json`](docs/attachments/public-validation.md)）。

## [0.5.1] — 2026-11-07

### Changed
- 任务完成即归档删除：`type: task` 且 `taskStatus: done` 写入成功后立即走版本化归档（工具 `memory_write` 返回 `operation: deleted`；`memory.write`/`memory.patch` 返回 `deleted: true`），不再保留在活跃列表；归档页仍可恢复，同步端收到墓碑不会复活。
- 真实宿主投递核对：在桌面 0.5.0 观察“创建 → 到点投递到 `new_once` 新会话 → 完成后删除宿主任务”全链路通过，证据 [`docs/evidence/S05-v050-tasks/host-delivery.json`](docs/attachments/public-validation.md)。

### Verification
- `tsc --noEmit` 0；`vitest` 43 文件 / 440 用例通过；隔离 `wh-s05` 21 步全部通过（宿主探针 `installedVersion 0.5.1`、bundle 哈希 `F3F7…940A`）。
- 候选包 `.work/dsh-auto-memory-wh-0.5.1.tgz`：148,491 字节 / `2F5E…9932`；`lib/index.js` `F3F7…940A`（193,836 字节）。
- 日常 `desktop` 由 0.5.0 升级到 0.5.1（证据 `desktop-upgrade-0.5.1.json`：7/7 检查通过、记忆摘要 `a582a8cf…` 前后一致、19 条 user scope 记录、9 bundles 保留）；重启 DSH 后生效。

## [0.5.0] — 2026-11-07

### Added
- 任务型记忆：`type: task` 与 `dueAt`/`remindAt`/`priority`/`taskStatus`（open/done/cancelled）四个可选字段；任务仍走 candidate → 审核 → verified 链路，未审核不提醒；任务不进入长期事实索引段。
- 到期提醒注入：`memory-wh:tasks` 独立系统提示段，只收 `verified + open + 未停用` 且到期/临近（24 小时内）的任务，同一会话同一任务只提醒一次；段内文本转义并声明“非用户指令”。
- 面板任务视图：类型筛选/编辑器支持 task；截止与提醒用 `datetime-local` 编辑；一键标记完成/取消/重新打开；候选任务提示“审核通过后才会提醒”。
- 同步与导入导出：`wh-sync-changeset` 与 `wh-memory-export` 的 `SyncRecord`/`ExportRecord` 增加任务字段（加法式扩展，旧端忽略），`sameContent` 计入任务字段，非 task 记录携带任务字段一律拒绝。
- 宿主调度桥接（方案 C，可选）：`src/schedule-bridge.ts` 通过 `ctx.get('schedule', false)` 以可选服务接入宿主 `dsh-schedule`；记忆始终是真源，sidecar `schedule-bridge.json` 记录 `name → scheduleId`；到点由宿主投递、重启补投；服务缺失/报错自动降级为会话内提醒；只清理带 `记忆提醒：` 标题与 `[memory-wh] task=` 标记的孤儿调度，不动用户自建任务；`schedule.status` API 与面板状态行。
- 测试与演练：任务模块 27 项单测（48 项随 store/工具/API/同步/面板覆盖），调度桥接 16 项单测；`task-schedule-drill.mjs` 17/17（创建/幂等/重启/改期/完成删除/降级/孤儿清理）。
- 候选构建与隔离验收：版本切到 `0.5.0`；`lib/index.js` `65FD…572B`（192,680 字节）、tarball 147,543 字节 / `F8A4…2AE5`；隔离 `wh-s05` 21 步全部通过，宿主探针 `installedVersion 0.5.0` 且 bundle 哈希与候选一致。
- 桌面升级：日常 `desktop` 由 0.4.0 升级到 0.5.0（证据 `desktop-upgrade-0.5.0.json`：7/7 检查通过、记忆摘要 `6ff5c30d…` 前后一致、18 条 user scope 记录、9 bundles 保留）；重启后生效，真实宿主到点投递已验证（见 Unreleased 的 r143 条）。

## [0.4.0] — 2026-11-07

### Added
- 同步协议 v1：`wh-sync-changeset`（毫秒游标、归档墓碑删除、校验和）；冲突默认保留本地已审核内容，需显式 `onConflict: remote` 才覆盖；CLI `sync-changes`/`sync-apply` 与 API `sync.changes`/`sync.apply`。
- 导出/导入包：`wh-memory-export` v1（记录、信任状态、校验和；导入一律 candidate、冲突不覆盖），API `export.package`/`import.plan`/`import.apply` 与 CLI `transfer-export`/`transfer-plan`/`transfer-apply`。
- 设备身份与加密同步：Ed25519 签名 + X25519 密钥协商 + AES-256-GCM 信封（`wh-sync-envelope`）；本地身份/信任文件与 CLI `sync-init`/`sync-trust`/`sync-seal`/`sync-open`；接收方校验收件人、信任列表、公钥一致性与签名，未信任或篡改均拒绝。
- 端侧适配契约：`SyncEndpoint` 接口与 `createLocalEndpoint`（游标、封装、解封、应用、幂等重放），协议说明 `docs/attachments/sync-protocol.md`；带加密信封的双向演练 9/9。
- 真实传输层：自托管 `wh-sync-relay` HTTP 中继（`POST /v1/messages`、`GET /v1/messages`、`POST /v1/ack`、`GET /v1/health`；共享 bearer token、按收件人落盘队列、幂等消息 id、保留期/队列上限/背压）；客户端 `SyncTransport`（超时与错误映射）；`sync-push`/`sync-pull`/`sync-relay` CLI；发送游标 `sentCursor`（发布成功才推进，与接收游标独立）；传输测试 12 项、HTTP 演练 14/14（含双向、重启持久化与毒消息留队）。
- 候选构建与桌面升级：版本切到 `0.4.0`，`lib/index.js` 与 tarball 记录哈希；隔离 `wh-s05` 21/21 通过；日常 `desktop` 由 0.3.0 升级到 0.4.0（记忆摘要不变，需重启 DSH 生效）。

## [0.3.0] — 2026-11-07

### Added
- 候选构建与隔离验收：版本切到 `0.3.0`，`lib/index.js` 与 tarball 记录哈希；隔离 `wh-s05` 上 21 步验收入口全部通过（21/21）。
- 项目 scope 管理：`listProjects` 只读盘点、`project-remap` 原子重映射、`project-merge` 同名冲突保护、`project-archive` 归档；不隐式合并、不删除记录。
- 跨会话召回排序：注入按 `memoryScore`（`lastReadMs ?? updatedMs ?? createdMs`，importance × 0.995^天）+ 同分项目优先；`memory_list` 支持 `sort=relevance|name`。
- 手动取代链：`memory.supersede` + 面板“标记为被取代”（同 scope、双向链接、可恢复，不自动合并）。
- 主题合并建议：`memory.mergeSuggest`（只读关键词聚类）与 `memory.merge`（candidate + 来源 `supersededBy` + `merge_apply` 审计），面板支持预览/勾选/确认。
- 并发写入可观测性：`memory.metrics` 返回进程内写入/失败/锁超时/忙/恢复/备份计数与平均/最长耗时，面板“运行指标”展示并与审计降级、存储只读状态并列。

## [0.2.0] — 2026-11-06

### Added
- `autoSummarizeMinTurns`（默认 2，0–40）与 `autoSummarizeMinChars`（默认 600，0–24000）：会话结束时先过门槛，不达标不调用模型；0 关闭。
- `autoSummarizeDedupe`（默认 true）：新建记忆前按同 `type`+同 `scope` 的正文/描述归一化去重；更新与取代路径不受影响。
- 合成评估语料 `tests/fixtures/autosummarize/corpus.json`（13 例）与评估入口 `scripts/verification/autosummarize-eval.mjs`，证据写 `docs/evidence/S05-v020-autosummarize/eval.json`。
- 只读宿主兼容探针 `scripts/verification/host-compat-check.mjs`：读取仓库窗口、宿主版本与 profile 安装状态，预测 DSH 是否跳过插件；证据写 `docs/evidence/S05-v020-compat/host-compat.json`。
- `docs/attachments/update-compatibility.md`（更新兼容 Runbook）与用户指南 7.2“DSH 自动更新后插件消失怎么办”。
- 启动自检与降级（`src/compat.ts`）：装载前检查插件面能力，缺失时只注册只读 `memory_wh_compat` 工具与 `/api/auto-memory-wh/compat.status`，不启动引擎、不触碰记忆。
- `scripts/verification/manual/backup-memory.ps1`：一条命令的已验证快照（backup + verify + manifest，DSH 运行中默认拒绝）。
- 面板批量审核：列表行可勾选，批量通过审核/批量退回待审核；逐条带 revision 调 `memory.review`，确认框要求“已阅读”，已处于目标状态的记录自动跳过，部分失败会列名。
- 近重复检测（`src/duplicates.ts` + `memory.duplicates` 路由 + 面板“查找近重复”）：本地 Jaccard 相似度，正文优先、CJK 二元组，只读提示不自动合并。
- 自动备份（`autoBackup` / `autoBackupIntervalHours` / `autoBackupKeep`）：定期把记忆树复制到 `<memoryDir>/.backups/auto/`，带 manifest 与保留份数；面板“立即备份”可手动触发。尽力而为、非离线快照。
- 迁移检查（`migration.status` 路由 + 面板“迁移检查”）：只读统计旧库 `~/.dsh/memory` 与当前库的记录数并给出迁移指引，不读写旧库正文。
- 候选构建与验收：版本切到 `0.2.0`，构建产物与 tarball 记录哈希；隔离 `wh-s05` 上 21 步验收入口全部通过（21/21）。
- 原生 0.2.0 复验：隔离原生 home 安装 0.2.0 后，断连 7/7、保存中关闭 8/8+6/6（命中写入中途，事务回滚）、界面内主动组装 9/9（审计 `pluginVersion 0.2.0`）全部通过。

### Changed
- `engines.dsh` 从 `>=0.2.1-rc.5 <0.3.0` 放宽到 `>=0.2.1-rc.5 <1.0.0`：非破坏性宿主更新不再因版本窗口过窄被整包跳过；由 `tests/manifest-compat.spec.ts` 守护窗口边界。
- `applyConsolidationCandidates` 统一候选应用与计数（created/updated/superseded/duplicate/chitchat/lowImportance/invalid），行为保持：候选强制为 `candidate`、伪造 evidence 丢弃、user scope 降级、maxMemories 上限。

## [0.1.0] — 首个可验收版本（本地自用，已完成）

### Changed

- 版本从 `0.1.0-rc.11` 提升为 `0.1.0`；`src/identity.ts`、`package.json`、`package-lock.json` 与仓库/README/UPSTREAM/架构页的版本说明一致更新。运行时代码与 rc.11 相同，仅版本字符串变化。
- 本轮 G4 收尾补上了真实账号路由下的多轮/工具调用接收、日常桌面真实回退演练，以及在 `0.1.0` 最终候选上重跑验收入口与原生桌面检查。
- 2026-11-06 为 DSH 0.2.2 增加 `engines.dsh` 兼容声明并重切候选（版本号不变），修复宿主升级后插件 bundle 被跳过、侧栏入口消失的问题；21 步验收入口在新宿主上重跑 21/21 通过。

### Validation boundaries

- 本地自用版本，所有者决定不公开发布；G5 不适用于本版本，发布就绪工作（`private:false`、公共包名可用、dry-run）保留为后续公开发布版本的基线。
- 验收基于隔离配置、合成数据与所有者执行的隔离设备测试；真实设备长期运行与极端故障组合仍需另行核验。

## [0.1.0-rc.8] — S05 本地候选快照，未发布

### Fixed

- 异步保存失败且草稿仍在时，将键盘焦点交还保存控件；保存成功并关闭编辑器后，将焦点交给可用的列表或刷新控件。
- 编辑器在读取尚未完成时等待可交互状态再接收焦点；避免把页面根节点误记为返回目标。

### Validation boundaries

- 仅在隔离 `wh-s05` 验收。原生桌面窗口仍受 Electron 启动检查阻断；真实数据和公开发布未执行。

## [0.1.0-rc.7] — S05 本地候选快照，未发布

### Fixed

- 键盘打开或新建记忆时，焦点进入编辑器标题；放弃草稿后返回原操作按钮，原按钮已消失时返回页面刷新按钮。

### Validation boundaries

- 仅在隔离 `wh-s05` 验收。原生桌面窗口仍受 Electron 启动检查阻断；真实数据和公开发布未执行。

## [0.1.0-rc.6] — S05 本地候选快照，未发布

### Documentation

- 更正 `UPSTREAM.md` 首段过时的 S03 alpha 状态；保留上游 MIT 版权和完整来源提交。
- 运行时审计、维护快照与 README 的候选版本标记同步到 rc.6。功能与存储格式不变。
- 开发锁文件将传递依赖 `zod` 从 4.6.5 更新至 4.6.7，第三方声明同步；本地锁文件 `npm audit --omit=dev` 的高危条目从 8 降为 0。该查询不覆盖宿主自行提供的依赖。

### Validation boundaries

- 仅用于隔离 profile；第三方许可义务、安全审查、真实记忆迁移及公开发布仍待完成。

## [0.1.0-rc.5] — S05 本地候选快照，未发布

### Documentation

- 第三方声明新增 `wh-s05` 实际解析的四个运行时依赖版本、许可字段和 LICENSE 哈希；保留开发锁文件清单，并明确两者范围不同。

### Validation boundaries

- 仅用于隔离 profile；第三方许可义务、安全审查、真实记忆迁移及公开发布仍待完成。

## [0.1.0-rc.4] — S05 本地候选快照，未发布

### Fixed

- WH 项目会话选择器从宿主已确认的活动映射读取，不再把仅存在于浏览器历史列表中的会话显示为可管理目标；会话失效后清空选择。

### Validation boundaries

- 已用内置 CLI 在 `wh-s05` 离线升级 rc.3→rc.4，浏览器确认活动项目记忆可读，并演练 rc.4→rc.3→rc.4；9 个合成记忆文件哈希不变。历史会话关闭/重建的下拉项动态过程尚待宿主验收。
- 真实记忆迁移、公开发布、真实模型和桌面 UI 子代理仍未完成。

## [0.1.0-rc.3] — S05 本地候选快照，未发布

### Fixed

- 组装信号在扫描前或扫描中取消时，记忆段失败关闭为零字节，并记录 `assembly-aborted` 尝试。
- 项目记忆注入、工具、管理页范围和自动固化使用宿主当前工作目录；目录服务异常时拒绝项目范围，切换项目时清除固化缓冲，防止子代理与目录切换串用旧项目记忆。

### Validation boundaries

- 已在 `wh-s05` 使用桌面版内置 CLI 离线升级、回退至 rc.2、恢复 rc.3；7 个合成记忆文件哈希不变。已安装 rc.3 的真实宿主 spawn/fork 探针与 271 项回归通过。
- 日常配置、真实数据、桌面 UI 子代理调用与真实模型仍未验收，G4 未通过。

## [0.1.0-rc.1] — S05 本地候选快照，未发布

### Changed

- 记忆注入改经宿主异步组装事件读取当前源文件，限并发扫描、逐文件验证，保留原审核、范围、转义和最终字节预算。
- 任一启用范围存储不可用时整段零字节，并在逐次组装审计中记录原因。
- 网络断连提示改为中文；编辑器说明区分列表刷新与整个网页刷新。

### Validation boundaries

- 隔离开发回归 267 项通过；真实模型压缩/子代理与日常配置仍未验收，G4 未通过。
- 该候选版仅用于 wh-s05 本地隔离安装，不代表公开发行。

## [0.1.0-rc.0] — S05 本地候选快照，未发布

### Fixed

- 导出 Markdown 和逐文件清单改为两个独立按钮，避免浏览器拦截一次点击触发的第二个下载。
- 登录失效、非 JSON 错误页和截断响应显示明确提示；修订冲突继续保留草稿。

### Validation scope

- S05 使用用户批准的隔离 wh-s05 配置，验证官方内置 CLI、实际 Web 管理页面和宿主 HTTP 认证；记录见 docs/progress。
- 新增 6 项回归测试，共 256 项通过。没有接入真实记忆、模型密钥或发布。
- 2000 条合成记录同步组装约 1.55 秒，尚不满足低延迟目标；压缩、子会话、Windows ACL 和真实数据验收仍开放。
- 这是本地候选包，不代表完整 v0.1.0 验收通过。数据仍为 WH v1；不能将 S03/上游代码直接接回当前库。

## [Unreleased] — 0.1.0-rc.11

### Changed

- 中文 README 中指向本机相邻目录的表述改为通用 `../memory/`（开发资料，不随包分发），英文 README 同步说明；消除 r81 分发审计发现的本地路径项。
- 版本常量与 `package.json`/`package-lock.json` 提升到 rc.11；无运行时代码或行为变化（`lib/index.js` 仅版本字面量变化）。

### Validation boundaries

- 本地隔离候选版；仅使用合成数据与 `wh-s05` 隔离配置，未接触真实记忆或日常 DSH。
- 原生桌面 rc.11、原生断连、主动组装与模型最终接收仍未验收；真实迁移和公开发布未执行。

## [Unreleased] — 0.1.0-rc.10

### Fixed

- 审计 `render_attempt` 事件、备份快照与恢复快照的 `pluginVersion` 改为读取单一版本常量，不再硬编码旧候选版本；新增回归断言，包版本与记录版本不一致时测试失败。
- rc.9 已安装包复核发现的版本字面量漂移（记录仍写 `0.1.0-rc.8`）在本版修复。

### Validation boundaries

- 本地隔离候选版；仅使用合成数据、内置 CLI 和 `wh-s05` 隔离配置，未接触真实记忆或日常 DSH。
- 原生桌面 rc.10、原生断连、主动组装与模型最终接收仍未验收；真实迁移和公开发布未执行。

## [Unreleased] — 0.1.0-rc.9

### Fixed

- 记忆编辑器的名称、标题、类型、摘要和正文改为逐项纵向排列；输入框适应卡片宽度，避免原生桌面窄窗口中字段挤在一行。

### Validation boundaries

- 本地隔离候选版，尚未完成原生桌面 rc.9 验收；真实数据和公开发布未执行。

## [0.1.0-beta.0] — S04 开发快照，未发布

### Added

- S04 人工审核流程及内容指纹；外部语义改动、缺失指纹和旧记录均不自动继承信任。
- 完整注入片段 0–65536 字节硬预算，转义后计算、跨范围唯一引用与明确排除原因。
- 每次组装回调记录 render_attempt；默认 1 MiB / 7 天，失败计数与降级提示。
- 新管理页面：范围选择、分页/筛选、纯文本预览、编辑/审核、置顶/静音、归档/恢复与 Markdown 导出。
- 所有模型修改与管理 API 修改接入 revision；冲突或断网保留页面草稿。
- 原生信任/审计/工具边界测试、管理 API 测试与 React DOM 交互测试。

### Changed

- 模型只注册 write/read/list/search/delete 五工具，删除改为带恢复 ID 的归档。
- 管理项目范围由宿主会话确认；拒绝任意 cwd，移除旧全库扫描与 Claude 自动扫描/导入路由。
- 移除小预算临时限制；不再信任缓存 MEMORY.md 作为自动注入来源。
- 三个固定版本的开发测试依赖加入锁文件，运行时 dependencies 不增加。

### Validation boundaries

- 250 项隔离测试、类型检查、构建、桌面核心服务探针及离线维护回归通过，详细证据见 S04 报告。
- 尚未安装或发布；桌面真实加载器、权限链、面板视觉、重启/压缩/子会话仍待 S05。
- reviewHash 不是防同权限恶意进程的签名。降级到 S03 会改变信任语义，不能直接让旧代码接管新库。

## [0.1.0-alpha.0] — S03 开发快照，未发布

### Added

- S03 作用域事务日志，提交前回退、提交后清理，以及显式离线恢复入口。
- 原字节软删除归档与无覆盖恢复；批量清空/修剪前生成可恢复快照。
- 只读迁移计划及哈希、源变化检查、备份校验、恢复演练、独立目标 staging 和可继续的迁移日志。
- 独立维护 CLI、数据格式标记、完整项目路径绑定、路径/链接与大小限制。
- 记录 revision 与可选 expectedRevision 冲突拒绝；未知顶层 frontmatter 字段在普通更新中保留。
- 25 项存储/恢复测试，含多进程写入、突然退出、故障恢复、目录链接、空间/权限模拟及迁移中断。

### Changed

- 无 WH 标记的非空旧库拒绝写入，必须经过迁移；不自动接管旧数据。
- 疑似孤儿锁不再由写入者自动删除；仅支持停写后的哈希/PID 核验与显式释放。
- 修剪在锁内重查年龄，单作用域批处理失败会回退；批量工具审批钩子继续保留。
- 功能测试限制为四个并行 worker、15 秒默认超时，以容纳刷盘；这不是性能目标。

### Validation boundaries

- 仅合成隔离数据；尚未安装、切换真实数据或发布。G2/G3 完整门槛仍开放。
- 完整 UI/API 版本检查、信任默认值、逐次审计、物理断电、Windows ACL、保留策略及永久擦除待后续阶段。

## [0.1.0-dev.0] — S02 开发快照，未发布

### Added

- 独立包、插件、API、界面语言、样式及 Prompt 段标识。
- 默认独立数据根 memory-wh，以及重复记忆工具占用检查。
- maxIndexBytes 旧键兼容、冲突诊断及绝对数据路径检查。
- 配置/隔离回归测试、阶段索引、依赖声明清单和包内容检查。

### Changed

- 核心 DSH peer 范围改为明确包含两个核验基线的预发布版本；不因此宣称完整 Desktop 兼容。
- CI 使用锁文件安装，保留上游源码基线与 MIT 版权。
- 根 README 改为独立项目说明，上游说明和历史文档归档。

### Development safeguards

- 当前为未发布开发版，package.private=true。
- 上游自动 npm/GitHub 发布工作流与针对上游仓库的 release 回填脚本归档停用。
- 尚未实现软删除、备份迁移、严格信任默认值等后续验收内容；未操作真实记忆。
