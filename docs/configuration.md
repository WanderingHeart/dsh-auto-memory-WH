# WH 配置（0.7.0）

配置处理先执行宿主 schema 默认值，再统一解析兼容键；验证失败时，在访问存储之前报错。

| 配置 | 当前默认/约束 |
|---|---|
| maxBytes | 4096；接受 0–65536 安全整数，含边界/转义/策略/截断提示的整段 UTF-8 字节 |
| auditMaxBytes | 1048576（1 MiB）；4096–4194304 整数 |
| auditRetentionDays | 7；1–365 整数，后续追加时清理过期行 |
| maxIndexBytes | 原任务书旧键；仅给旧键时等同 maxBytes |
| memoryDir | 不填则为经宿主解析的 DSH_HOME/memory-wh；填写时必须是非空绝对路径 |
| enableUserScope | true |
| notifyWhale | auto；`auto` 时若检测到小鲸鱼插件的 `window.__dshWhaleNotify`，到期任务额外弹气泡（常驻 + 任务结束音）；`off` 只走宿主投递与会话内注入 |
| notifyDone | true；长轮次结束后用小鲸鱼气泡提示“这一轮跑完了”，没装小鲸鱼时静默 |
| notifyDoneMinSeconds | 60；10–3600 整数，只有运行时长达到该秒数的轮次才提示 |
| edition | full；`minimal` / `standard` / `full` 三档，共用同一份存储，只影响注入预算建议与可选功能。面板工具栏的“档位”滑条可运行时切换，选择写入 `<记忆根>/settings.json` 并优先于本项 |
| autoSummarize | true（rc.19 起；显式 false 仍关闭） |
| autoSummarizeMaxMemories | 5 |
| autoSummarizeMaxTokens | 2048（输出限制，不是总成本） |
| autoSummarizeMinTurns | 2；0–40 整数，0 关闭“最少 USER 轮数”门槛 |
| autoSummarizeMinChars | 600；0–24000 整数，0 关闭“转写最小字符数”门槛 |
| autoSummarizeDedupe | true；同 type+scope 且正文或描述归一后相同的新候选不重复落盘 |
| autoMerge | true；只处理有主题、非同任务/置顶/禁用的记录。同主题且相关 ≥60% 自动合并；同主题或相关任一 ≥60% 只进面板待确认；两者都不达标不处理。启动 20 秒后与会话固化后各对账一次，可撤销 |
| autoSummarizeIdleMinutes | 60；0–1440 整数，会话闲置多少分钟后触发一次固化；0 表示只在会话结束时触发 |
| autoBackup | false；开启后定期把记忆树复制到 `<memoryDir>/.backups/auto/`（尽力而为，非离线快照） |
| autoBackupIntervalHours | 24；1–720 整数，两次自动备份的最小间隔 |
| autoBackupKeep | 5；1–50 整数，保留的自动备份份数，超出后删除最旧 |
| minImportance | 4（总结候选的价值筛选门槛） |
| staleAfterDays | 0，关闭 |

两预算键同时给出且数值不同，配置拒绝加载；数值相同则允许。schema 不抢先填充 maxBytes，否则会误把只提供旧键的配置当成冲突。最终默认值由 normalizeConfig 统一落实。

S04 已移除临时 4096 字节下限。0 或不足以容纳完整行及固定文本的预算产生空注入；置顶不能突破上限。预算不包含宿主其他 Prompt 段、工具 schema 或后续读取正文，不等于 token 限额。

默认独立目录保持 memory-wh。S03 会拒绝写入已有非空、无 WH 格式标记的旧根；不会自动补标记升级。迁移通过单独的只读计划、备份、恢复演练和独立目标流程执行，详见 [存储与恢复说明](storage-recovery.md)。显式 memoryDir 不是迁移授权，当前仅供隔离开发环境使用。

检测到已有 memory_write/read/list/search/delete 任一工具占用时，WH 拒绝加载。同名工具不能通过换 UI 名称实现安全共存。该检查覆盖 WH 后加载的情形；上游后来再加载时不会自动遵守 WH 的检查，因此运行配置仍必须只启用一个记忆插件。

v0.2.0 起，会话结束固化会先过 `autoSummarizeMinTurns` 与 `autoSummarizeMinChars` 门槛：不达标时直接跳过，不调用模型（节省 token，也避免把寒暄固化成记忆）。`autoSummarizeDedupe` 在“新建”分支前做同 type+scope 的正文/描述归一比较，命中即跳过；更新/取代路径不受影响。评估语料在 `tests/fixtures/autosummarize/corpus.json`，可重复入口为 `node scripts/verification/autosummarize-eval.mjs`（证据写 `docs/evidence/S05-v020-autosummarize/eval.json`）。

活动 Markdown 的基础格式沿用上游；S03 新增 WH 格式标记、项目路径绑定、事务日志、归档和快照。未知顶层元数据在普通写入中保留，迁移与归档保留原始文件字节。rc.19 起自动总结默认开启。S04 增加 reviewHash：记录内容的完整性指纹，不是签名或身份凭据。新写入与旧记录都自动注入；只有 disputed、superseded、停用或过期的记录被排除。

## 任务提醒（v0.9.0）

- `memory_remind`：模型工具，直接创建宿主原生提醒；参数 `title`（必填）、`inSeconds` 或 `dueAt`、`prompt`、`route`（`auto` 默认 / `current` / `new`），`newSession` 保留为 `route=new` 的兼容别名。默认投递当前会话；提醒文字明确命中另一个已知项目时改投该项目 `cwd` 的一次性新会话；同时命中本会话与其他项目、或命中多个项目时**不创建**，返回 `needsConfirmation` 与问题，模型询问后用 `route=current` / `route=new` 重试。宿主没有 `schedule` 服务时返回 `REMINDER_UNAVAILABLE`。
- `memory_reminders`（v1.0.0-rc.8）：只读列出本插件创建的提醒，并把 `scheduledAt` 换算成**本机时区**的 `localTime` 一起返回；`timeZone` 是用户机器的 IANA 时区。提醒本身仍由宿主调度器持有，本工具不修改、不删除。宿主自带的 `schedule_list` 由宿主格式化（其 `scheduledAtLocal` 可能是 UTC），需要本地时间时以本工具为准。
- `notifyWhale`：`auto`（默认，检测到小鲸鱼钩子才弹气泡）/ `off`。

## 功能档位（rc.17 核对）

表中“是”表示档位允许，不代表自动总结或备份默认开启。所有档位保留索引注入，仍受 maxBytes（0 关闭）与作用域等配置控制。

三档共用同一份 `memory-wh` 与同一套写入/信任语义，只改变注入预算建议、可选功能与后台任务；随时切换档位不需要迁移，也不会隐藏或改写已有记录。

| 档位 | 索引预算 | 提醒 | 自动固化 | 自动备份 | 近重复/合并 | 关系图 | 导入导出/迁移 | 索引注入 |
|---|---|---|---|---|---|---|---|---|
| `minimal` | 2048 | 否 | 否 | 否 | 否 | 否 | 否 | 是 |
| `standard` | 4096 | 是 | 是 | 是 | 是 | 否 | 是 | 是 |
| `full`（默认） | 4096 | 是 | 是 | 是 | 是 | 是 | 是 | 是 |

- 未启用的 API 返回 `EDITION_DISABLED`（403），面板隐藏对应入口。
- 预算列是建议值；实际仍以 `maxBytes` / `auditMaxBytes` 配置为准。
- `autoSummarize` / `autoBackup` 即使配置为 `true`，在低档位也不会运行。

## 主题与自动合并（v1.0.0-rc.2）

- 每个 scope 目录一份 `topics.json`（id + 展示名 + 一句话说明），记录通过 `topic` 字段引用主题 id；中文 id 可直接使用（如 `考研`）。
- `memory_write` / `memory_patch` 与管理 API 都接受 `topic`；自动总结写入时按注册表做词面匹配，未命中记为 `未归类`，不参与自动合并，等人工在面板调整。
- 自动合并只处理“有主题 + 非任务/置顶/禁用”的记录：同主题且相关 ≥60% 自动合并；同主题或相关任一 ≥60% 只进面板待确认；两者都不达标不处理。产物是一般记录（可直接注入），来源标记为 `superseded`，账本保留最近 100 条，撤销即恢复。
- 词面增强（v1.0.0-rc.12）：高置信同义词归一到同一词元（如 考研/研究生考试、发布/release），名称里的连字符与下划线按子词再切分；面板的自动合并/待确认列表优先显示中文标题，没有标题才显示记录名。
- 迁移：`scripts/verification` 之外的 `.work/migrate-topics.mjs` 为一次性脚本，先 `--dry-run` 再执行；迁移后可用质量体检确认没有缺主题的记录。


## 双层记忆（rc.18）

自动/手动会话总结在一次模型请求中生成项目详情和 userSummary（最多 160 字符）。四种类型均适用。有效概括自动写入用户级；enableUserScope=false 禁止生成和注入该层。rc.19 起 autoSummarize 默认 true，自动路径需 standard/full 档并满足原门槛；手动总结沿用面板入口。autoSummarizeMaxMemories 限制主记录数，每条合格项目记录最多附带一条概括；不额外调用模型，但输出 token 可能略增加。两层共享 maxBytes。无效/缺失概括或写入失败保留项目详情并记录日志，不复制详情兜底。旧记忆不自动回填；面板编辑/导入/归档不自动改写另一层。详见 README 的使用例子。
