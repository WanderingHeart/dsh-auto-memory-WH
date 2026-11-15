# WH 用户指南（1.0.1 稳定版）

本指南面向已经安装 DeepSeek Harness（DSH）、想试用 WH 持久化记忆插件的用户。

> **当前状态**：本指南对应 1.0.0 稳定版；各版本的测试范围与结果见发布报告。
> 第一次试用请使用**空目录或合成数据**，不要直接指向你已有的真实记忆。
> 详细门槛见 [发行前清单](../progress/2026-11-06_018_发行前门槛清单.md)。

---

## 1. 它是什么

WH 是 DSH 的持久化记忆插件（插件 ID `auto-memory-wh`，界面显示“记忆 WH”）。它把记忆保存为 Markdown 文件，并在每次会话组装 System Prompt 时，把记忆的“名称 + 一句摘要”注入给模型。

从 1.0.0-rc.10 起，**没有“用户审核”这一步**：写入即生效，记录直接参与注入。当前面板提供编辑、置顶和归档；不再提供静音、人工审核或手动标记被取代按钮。合并产生的“已取代”等标签由系统维护，不是使用前需要手动设置的状态。

几个重要设计：

- 新写入的记录显示为 **自动记录**（candidate），旧格式显示为 **旧记录**（legacy）；两者都会注入。
- 只有 **有争议**（disputed）、**已取代**（superseded）、**旧记录停用标记**（disabled）或**过期**的记录不注入。
- 置顶（pinned）只影响排序。
- 删除是**可恢复归档**，不是隐私擦除。
- 记忆保存在本地 `DSH_HOME/memory-wh`（可配置）；总结和召回使用宿主模型时，相关内容会随模型请求发送。

---

## 2. 安装前检查

1. 已安装 DSH，并能正常打开桌面窗口。
2. 使用**内置 CLI**，不要用 PATH 上可能残留的旧 `dsh`：

   ```powershell
   C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd --version
   ```

3. 准备好已核验的 `dsh-auto-memory-wh-1.0.1.tgz`，或通过宿主插件管理器安装 npm 精确版本 `dsh-auto-memory-wh@1.0.1`。
4. 关闭 DSH（安装/卸载插件时宿主不能正在运行）。
5. **先备份**你准备使用的记忆目录（如果它已有内容）。

---

## 3. 安装

DSH 用 profile 管理配置。桌面应用通常使用 `desktop` profile，位置在：

```text
%USERPROFILE%\.dsh\profiles\<profile>
```

安装插件（把路径替换成实际 tgz 的绝对路径）：

```powershell
$dsh = 'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add 'C:\path\to\dsh-auto-memory-wh-1.0.1.tgz' --ignore-scripts
```

离线或需要固定 store 时：

```powershell
& $dsh plugin --profile desktop add 'C:\path\to\dsh-auto-memory-wh-1.0.1.tgz' --ignore-scripts --prefer-offline --store-dir 'C:\path\to\pnpm-store'
```

安装完成后：

1. 打开 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，`dependencies` 里应出现 `dsh-auto-memory-wh`。
2. 确认版本：

   ```powershell
   Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-auto-memory-wh\package.json" |
     Select-String '"version"'
   ```

3. 重新打开 DSH，左侧/插件区域应出现“记忆 WH”页面，模型侧应注册 `memory_*` 工具。

> 如果宿主里已经存在同名工具（另一份记忆插件），WH 会**拒绝加载**，避免两个插件争抢。请只启用一个记忆插件。

---

## 4. 配置

默认数据目录是 `$DSH_HOME/memory-wh`。要改配置，在 profile 的 `cordis.patch.yml` 里按插件 id 覆盖：

```yaml
- id: auto-memory-wh
  config:
    memoryDir: 'C:\path\to\memory-wh'
    maxBytes: 4096
    enableUserScope: true
    autoSummarize: true
```

| 配置 | 默认 | 说明 |
|---|---|---|
| `memoryDir` | `$DSH_HOME/memory-wh` | 必须是绝对路径；指向旧库**不等于**迁移 |
| `maxBytes` | 4096 | 每次注入的名称+摘要总字节上限（0–65536） |
| `enableUserScope` | true | 关闭后用户作用域工具/页面被拒绝 |
| `autoSummarize` | true | rc.19 起自动总结默认开启 |
| `autoMerge` | true | 同主题且相关 ≥60% 自动合并；同主题或相关任一 ≥60% 只进面板待确认 |
| `auditMaxBytes` | 1048576 | 审计文件滚动阈值 |
| `auditRetentionDays` | 7 | 审计保留天数 |
| `staleAfterDays` | 0 | 过期筛选，0 表示关闭 |
| `edition` | `full` | `minimal` / `standard` / `full`，面板里的选择优先 |

注意：

- `maxBytes` 是**字节预算**，不是 token 上限，也不包含宿主其它 Prompt 段与工具 schema。
- 指向已有非空、且没有 WH 格式标记的目录会**拒绝写入**（不自动接管旧库）。
- 想迁移旧库请走[存储与恢复说明](../storage-recovery.md)的 `inventory → plan → apply` 流程，并单独生成备份。

---

## 5. 日常使用

### 类型、作用域与状态分别是什么

- **类型 type**：user（用户信息）、feedback（反馈）、project（项目信息）、reference（参考资料），用于描述内容和筛选。类型叫 project 不会自动把记录迁入项目作用域。
- **作用域 scope**：用户级或项目级，决定存放位置及在什么项目会话中参与注入；用户级还受 enableUserScope 控制。面板类型筛选不等于改变 scope。
- **内部状态 status**：自动记录、系统确认、旧记录、有争议、已取代等标签。新记录不需要人工审核；当前面板主要展示标签，合并会自动维护取代关系。
- **旧 disabled 字段**：底层仍读取并排除这类旧记录，但面板的静音操作已经移除，不能当作现行公开功能介绍。

rc.18 起，四种类型都可用于两层记忆。总结模型在一次请求中输出项目级详情和最多 160 字符的 userSummary；有效概括自动保存为相同类型的用户级记录。相同 cwd 的项目会话可读取详情，其他项目参与注入的只有用户级概括。索引仍只带名称/标题与描述，正文需工具读取。

自动总结需 standard/full 档、autoSummarize=true，并达到轮数/字符门槛；用户级概括还需 enableUserScope=true。面板手动会话总结使用相同流程。memory_write 也接受 userSummary，项目写入后自动处理，无需再写一次用户级。

例如项目级记录“阿克曼小车项目已完成，使用专用虚拟机验证”的具体过程，用户级保存“用户之前完成过阿克曼小车项目”。尚在进行的项目不得被概括为已完成。四种类型都遵循这一规则；没有跨项目价值时可不生成概括。

概括按项目和来源记录关联，重复总结更新原概括，矛盾取代沿来源链维护。用户级不复制详情正文、证据原文或项目主题 id；模型被要求省略本地路径、凭据和具体配置，并对明显格式做校验。该校验不能替代人工对隐私及模型准确性的判断。概括缺失、无效或保存失败时，详情保留且日志记录原因，工具写入返回 userSummary 处理状态；不以截断详情兜底。

每批 autoSummarizeMaxMemories 限制主记录数，每条项目记录最多附带一条概括；两层共享索引预算。关闭用户级不删除已有概括，只停止新建和注入。旧记录不会因升级自动回填，可重新总结相关会话或通过工具提供概括。

两层是可独立管理的普通记录。面板手动编辑/导入/归档不会自动调用模型或改写另一层；归档详情并不删除已形成的用户级经历，需要遗忘时分别处理。自动生成的概括后续可能在再次总结时更新；人工编辑后需留意后续自动更新。回退 rc.17 保留已有普通记录，但旧版不再自动维护概括。

此前 rc.17 缺口记录见 [分层验证](../progress/2026-11-15_005_用户级与项目级记忆分层验证.md)，该历史结论不代表 rc.18。

### 5.1 面板

打开“记忆 WH”页面：

1. 选择范围：**用户**（跨项目）或**项目**（当前会话对应的项目目录）。
2. 查看列表、搜索及按类型筛选。类型筛选只影响当前列表，不是注入范围开关。当前没有状态筛选入口。
3. 打开记录编辑标题、摘要、正文；**保存后立即生效**，无需再确认。
4. 置顶或移至归档；归档页可恢复。合并后来源显示“已取代”，可在合并记录中撤销；当前列表不提供静音或手动标记被取代按钮。
5. 存储状态区显示数据根、只读原因、最近批量快照时间。
6. “查找近重复”只做本地相似度提示，按相似度分组列出候选，不会自动合并或改写；是否归档/改写由你决定。
7. “立即备份”把当前记忆树复制到 `.backups/auto/`；“迁移检查”只统计旧库与当前库的记录数并给指引，不会自动迁移。
8. “重复与合并”按主题扫描：同主题且相关 ≥60% 的组直接自动合并（可撤销）；同主题或相关只满足一项的组进入“待确认”，由你决定是否合并；两者都不达标不显示。产物是普通记录，来源标记为被取代，可恢复；点“确认合并”或“合并这一组”即执行，不再弹二次确认；列表优先显示中文标题，没有标题才显示记录名。
9. “关系图”显示当前范围内记录之间的相关性；“人物弧光”把用户层与全部项目的记忆按主题成章、章内按时间排序，只读展示来源、状态与取代关系，不返回正文、不写记忆。
10. “总结”浮层列出最近活跃的会话，点一个立即把该会话的未固化对话整理成记忆；候选行显示会话标题，路径只放在悬停提示里。
11. “运行指标”显示当前进程的写入次数、平均/最长耗时、错误、锁超时、忙与恢复/备份计数，以及审计与存储状态；计数器仅本进程，CLI 维护操作不计入。

**JSON 包导入/导出**：

- “设置 → 导出 JSON 包”下载当前范围的完整记忆包（含主题、任务字段与校验和）。
- 把包拖进面板（或“设置 → 导入 JSON 包”选择文件）会先只读预演：显示文件体积、记录数、新增/更新/相同/冲突数量；超过 2 MB 会提示拆分包。
- 有冲突时可选择“保留本地版本，跳过远端”或“两边都留（远端存为独立版本）”；点“应用导入”之前不会写任何东西。
- 导入的文件不是 WH 记忆包（缺 `records` 列表或不是合法 JSON）时只提示、不调导入预演。

### 5.2 模型侧工具

| 工具 | 用途 | 关键限制 |
|---|---|---|
| `memory_write` | 新建或按 revision 更新记录 | 不能写 `type: task` |
| `memory_read` | 读正文、状态、revision | disputed/superseded 只是不可信背景 |
| `memory_list` | 列元数据，分页 | 默认当前项目、25 条 |
| `memory_search` | 本地关键词搜索 | 无 embedding，默认 5 条 |
| `memory_delete` | 按 revision 归档 | 返回 archiveId，可恢复 |
| `memory_remind` | 创建宿主原生提醒 | 默认投本会话；可 `route=current\|new` |
| `memory_reminders` | 列出本插件创建的提醒，时间按本机时区 | 只读；提醒本身在宿主调度器 |

### 5.3 注入规则

每次组装都会重新读源文件，不信任 `MEMORY.md` 缓存：

- 除 disputed、superseded、旧数据 disabled 标记、过期之外的记录都会入选，包括自动记录与旧记录。
- 置顶优先；其余按重要度、更新时间、稳定 id 排序。
- 预算装不下完整条目时输出空段，不切断多字节字符。
- 写事务进行中，索引读取会返回空段（fail-closed），避免注入中间状态。

### 5.4 任务与提醒

任务提醒不写入记忆库：它是一个“一句话提醒”，只存在宿主原生的“自动化任务”里。

- 让模型建提醒：说“一分钟后提醒我刷牙”，模型会调用 `memory_remind({ title, inSeconds | dueAt, prompt?, route? })`。默认投递到当前会话；提醒文字命中其他已知项目时改投该项目的新会话并带上项目 cwd；同时命中本会话与其他项目、或命中多个项目时先返回询问（不创建），确认后用 `route=current` 或 `route=new` 重试。
- `newSession: true` 是 `route=new` 的兼容别名。
- 原生“自动化任务”页：所有提醒都会出现在这里，可手动暂停、删除或改时间。这里新建的任务不属于记忆库，也不参与记忆的备份/同步。
- 想知道提醒到底在什么时候：调用 `memory_reminders`，它返回 `timeZone` 与每条提醒的 `localTime`（按你机器时区）。宿主自带的 `schedule_list` 仍可能按 UTC 显示。
- 记忆库不接受 `type: "task"`；旧版本留下的任务记录只读兼容。

### 5.5 小鲸鱼气泡与相关记忆

- 气泡提醒：如果桌面装了 `dsh-whale-widget` 且它的前端暴露 `window.__dshWhaleNotify`，插件会在 DSH 打开时每 30 秒（或页面重新可见时）拉一次到期任务，用小鲸鱼气泡提醒；同一任务同一提醒时刻只弹一次（`sessionStorage` 记 24 小时），改期会再提醒。没有钩子、钩子报错或配置 `notifyWhale: 'off'` 时自动降级，不影响宿主投递与会话内注入。
- 气泡常驻且可带“任务结束音”（复用挂件设置里的提醒音）；配置见 `docs/configuration.md` 的 `notifyWhale`。
- 这个钩子不来自上游：issue [#331](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/issues/331) 从 2026-11-07 起一直 open、无人回复。**决定按本地长期补丁维护**，不再等上游合并（补丁在 `.work/whale-upstream` 的 `feat/external-notify-hook` 分支）。
- 升级小鲸鱼插件会覆盖补丁文件。升级后先跑 `node scripts/verification/reapply-whale-patch.mjs --check`；提示 hook missing 时去掉 `--check` 重打（脚本会备份为 `whale-widget.js.before-wh-patch`，并用 `node --check` 验证；锚点不兼容会失败并保持降级，不会写坏文件）。
- 相关记忆：打开一条记录的编辑器时，底部“相关记忆”按共享词、`[[name]]` 引用、同项目、同类型/作用域与时间邻近打分，列出 30 分以上的记录与理由（30–59 弱、60+ 强）。只作参考，不合并、不改写、不落盘。

### 5.6 长轮次完成通知

- 当一轮回复运行超过 `notifyDoneMinSeconds`（默认 60 秒）时，插件会在这一轮结束后用小鲸鱼气泡提示“✅ 这一轮跑完了，用时约 N 分钟”，并播放挂件设置里的提醒音。
- 只跟踪运行时长，不读写记忆；宿主重启后缓冲清空，不影响历史。
- 关闭方式：配置 `notifyDone: false`；调整阈值：`notifyDoneMinSeconds`（10–3600）。没装小鲸鱼时静默，不影响任何其他功能。

### 5.7 功能档位

- 配置 `edition` 选 `minimal` / `standard` / `full`（默认 `full`）。三档读同一份 `memory-wh`，随时切换不需要迁移，也不会隐藏或改写既有记录。
- `minimal`：只保留索引注入与最小工具面（不注册 `memory_remind` / `memory_reminders`），关闭自动固化、备份、合并、关系图、人物弧光、导入导出与迁移检查。
- `standard`：启用提醒、自动固化、备份、合并、导入导出与迁移；不含关系图和人物弧光。
- `full`：当前完整能力。
- 未启用的 API 会返回 `EDITION_DISABLED`，面板隐藏对应按钮；当前档位可在“设置 → 存储”里看到，也可以直接点工具栏的“档位”拖动低 / 中 / 高滑条切换。
- 面板上的切换会写到 `<记忆根>/settings.json`，下次加载继续沿用；它不需要重启，API 门禁、`memory_remind` 与自动备份会立刻按新档判断。改 DSH profile 里的 `edition` 仍是默认值，文件里的选择优先。

---

## 6. 备份与恢复

维护入口是构建产物，不是 DSH 子命令：

```powershell
node .\lib\maintenance-cli.js --help
node .\lib\maintenance-cli.js <命令> <请求.json>
```

### 6.1 备份

请求示例（目标目录必须**不存在**，且先停止所有写入者）：

```json
{
  "source": "C:\\Users\\me\\.dsh\\memory-wh",
  "destination": "D:\\wh-backups\\2026-11-06",
  "selection": { "includeAudit": true, "includeArchive": true },
  "writersStopped": true
}
```

```powershell
node .\lib\maintenance-cli.js backup .\backup-request.json
```

需要定期自动备份时，在插件配置里设 `autoBackup: true`（默认关闭），并用 `autoBackupIntervalHours`（默认 24）与 `autoBackupKeep`（默认 5）控制间隔和保留份数。自动备份写入 `<memoryDir>/.backups/auto/`，是**尽力而为的复制**：每个文件本身是原子的，但多个文件不保证来自同一时刻；需要精确快照时仍用上面的 `backup` 命令。

### 6.2 校验与恢复

```powershell
node .\lib\maintenance-cli.js verify .\verify-request.json
node .\lib\maintenance-cli.js restore .\restore-request.json
```

- `verify` 需要 `file` 与 `expectedHash`，会校验快照版本、路径、逐文件哈希。
- `restore` 只恢复到**全新目录**，拒绝覆盖当前库；恢复后再把 `memoryDir` 指过去。
- 恢复点之后的新写入不会自动合并。真实回滚前先给当前库再做一份快照。

### 6.3 单条恢复

```powershell
node .\lib\maintenance-cli.js archive-list .\archive-list.json
node .\lib\maintenance-cli.js archive-restore .\archive-restore.json
```

`archive-restore` 遇到同名文件会拒绝，需要先处理当前记录。

### 6.4 从旧库迁移

面板的“迁移检查”只统计旧库 `~/.dsh/memory` 与当前库的记录数并给出提示，不会读写旧库正文。正式迁移仍用离线流程：关闭 DSH，对旧库跑 `inventory` 与 `plan`，人工确认计划后用 `apply` 生成独立的新目录（先备份、再恢复演练；不会覆盖旧库）。

### 6.5 导出/导入记忆包（CLI）

导出（同 scope）：

```powershell
node src\maintenance-cli.ts transfer-export request.json
# request.json: {"root":"<绝对路径>","scope":"user","out":"<绝对路径>/export.json"}
```

预览与导入：

```powershell
node src\maintenance-cli.ts transfer-plan request.json
node src\maintenance-cli.ts transfer-apply request.json
# transfer-plan: {"file":"...","root":"..."}
# transfer-apply: {"file":"...","root":"...","approvedChecksum":"<plan 返回的校验和>","onConflict":"skip|fork"}
```

导入后记录直接参与注入（1.0.0-rc.10 起无审核步骤）。内容不同的记录默认跳过（保留本地）；`"onConflict":"fork"` 会把远端版本另存为同范围的独立记录，名称带 `-shared-` 后缀，本地内容不动。预览里的 `conflicts` 列出需要选择的名字。

### 6.6 双端同步（CLI）

两台设备各自维护 state 文件，交替导出/应用变更集：

```powershell
# 设备 A：导出 since 之后的变更
node src\maintenance-cli.ts sync-changes request.json
# {"root":"<A 绝对路径>","scope":"user","deviceId":"device-a","stateFile":"<A>/sync-state.json","out":"<A>/changes-a.json"}

# 设备 B：应用并推进游标
node src\maintenance-cli.ts sync-apply request.json
# {"root":"<B 绝对路径>","file":"<A>/changes-a.json","approvedChecksum":"<sync-changes 输出>","stateFile":"<B>/sync-state.json"}
```

然后 B 用同样的 `sync-changes`（stateFile 指向 B）导出、A `sync-apply` 应用，形成双向。冲突默认保留本地内容并报告名称；确认要用远端版本时加 `"onConflict":"remote"`，想两边都留用 `"onConflict":"fork"`。变更集携带 `topic`。删除会进入归档，可在面板恢复。

### 6.7 设备身份与加密同步（CLI，可选）

同步文件在磁盘上时可以加一层身份与加密：每台设备生成一对签名密钥（Ed25519）和一对加密密钥（X25519）；接收方只接受信任列表里的发送方，信封同时校验收件人、签名与密文。

```powershell
# 1. 每台设备生成身份（私钥文件请自行限制权限）
node src\maintenance-cli.ts sync-init request.json
# {"file":"<设备>/identity.json"}

# 2. 交换公钥：把对方身份文件的 deviceId/signPublicKey/encPublicKey 加入本机信任
node src\maintenance-cli.ts sync-trust request.json
# {"trustFile":"<设备>/trust.json","action":"add","deviceId":"dev-…","signPublicKey":"…","encPublicKey":"…","label":"laptop"}

# 3. 发送方加密变更集给指定收件人
node src\maintenance-cli.ts sync-seal request.json
# {"file":"<A>/changes-a.json","identityFile":"<A>/identity.json","trustFile":"<A>/trust.json","recipient":"dev-…","out":"<A>/changes-a.envelope.json"}

# 4. 接收方解封（未信任发送方、错误收件人、签名或密文被改都会拒绝）
node src\maintenance-cli.ts sync-open request.json
# {"file":"<A>/changes-a.envelope.json","identityFile":"<B>/identity.json","trustFile":"<B>/trust.json","out":"<B>/changes-a.json"}
```

解出的变更集仍按 6.6 的 `sync-apply` 应用（校验和不变）。边界：身份是本地明文 JSON，没有 OS keychain；没有传输层、密钥轮换与撤销列表；信任一旦加入即长期有效，移除需手动 `sync-trust`；加密只保护文件内容，不隐藏文件名或时间。

### 6.8 给同步载体作者的契约

如果你要把同步接到网盘、浏览器扩展或移动端，先读 [同步协议与端侧适配契约](sync-protocol.md)。核心约定：载体只原样搬运 `wh-sync-envelope` 字节，不重排 JSON；每端各自保存游标；至少一次投递即可，端点负责幂等；单信封上限 8 MiB，超出按 `since`/`until` 分段。仓库内 `src/endpoint.ts` 的 `SyncEndpoint` 与 `createLocalEndpoint` 是可运行的参考实现。

---

## 7. 升级与卸载

### 7.1 升级

升级前建议先备份一次（会自动校验并写 manifest；DSH 未关闭时脚本会拒绝执行）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verification\manual\backup-memory.ps1
```

再关闭 DSH，安装新 tgz：

```powershell
& $dsh plugin --profile desktop add 'C:\path\to\dsh-auto-memory-wh-1.0.0-rc.NN.tgz' --ignore-scripts
```

升级不会动 `memory-wh`。如果安装进程中断或只装了一半：

1. 重新执行同一条 `add`；pnpm 会补齐。
2. 若提示版本已存在但文件不完整，先 `remove` 再 `add`。
3. 核对：`profiles\desktop\package.json`、`node_modules\dsh-auto-memory-wh\package.json`、`memory-wh` 文件哈希。

### 7.2 DSH 自动更新后插件消失怎么办

先别重装、更别删 `memory-wh`。插件只是被宿主的兼容检查跳过了：

1. 确认文件还在：
   ```powershell
   Test-Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
   Test-Path "$env:USERPROFILE\.dsh\memory-wh\_user\MEMORY.md"
   ```
2. 安装覆盖新宿主版本的新 tgz（关闭 DSH 后执行 `dsh plugin --profile desktop add <tgz> --ignore-scripts`），重开 DSH。
3. 如果只是版本范围窄、API 未变，也可在插件管理器的“版本豁免”里为该精确版本授权；豁免是显式风险接受。
4. 完整机制与恢复顺序见 [DSH 更新兼容性 Runbook](update-compatibility.md)。

### 7.3 卸载

```powershell
& $dsh plugin --profile desktop remove dsh-auto-memory-wh
```

卸载**不会**删除 `memory-wh`。要彻底清理，先自己做备份，再手动删除该目录（本版本没有永久擦除命令）。

---

## 8. 故障排查

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 面板没有“记忆 WH” | 插件未装进当前 profile / DSH 未重启 | 查 `profiles\desktop\package.json`，重启 DSH |
| 加载被拒绝 | 已有同名记忆工具占用 | 停用另一份记忆插件，只保留一个 |
| 页面 401/403 | 会话未认证 / 会话已关闭 | 重新打开页面；关闭的会话不恢复 |
| `Storage busy or recovery required` | 有写锁或事务日志残留 | 关闭 DSH → 检查锁 → `recover` / `unlock` |
| 审计显示降级 | 队列满、写失败、文件超限 | 查 `audit.jsonl` 大小/权限，释放磁盘空间 |
| 注入为空 | 记录带旧 disabled 标记/过期/有争议/已取代，或预算太小、用户作用域关闭 | 核查归档/合并与旧数据标记、调大 `maxBytes`、检查范围配置 |
| 导入没有预览 | 文件不是合法 JSON 或没有 `records` 列表 | 用面板“导出 JSON 包”重新导出 |
| `ENOSPC` | 磁盘满 | 清理空间后执行 `recover`，再重试写入 |
| 版本冲突 | 记录被并发修改 | 重新读取最新记录，人工合并后保存 |

维护命令示例（`writersStopped` 必须是操作者确认已停写）：

```json
{ "root": "C:\\Users\\me\\.dsh\\memory-wh", "writersStopped": true }
```

锁释放还要提供 `lock`（根内相对路径）、`expectedHash`，且锁内容必须是已退出的进程 PID。

---

## 9. 隐私与安全

- 数据只存在本地；插件没有云上传、遥测或外部模型调用。
- **记忆会进入发给模型的请求**（名称+摘要；正文按需读取）。使用第三方模型时，请按对方隐私政策评估。
- 审计 `audit.jsonl` 记录记忆名称、时间、版本哈希与会话/项目哈希，**名称可能泄露含义**；它不记录全文或完整 Prompt。
- 备份未加密；请自行保存在受控位置。
- 归档与旧快照仍保留内容，软删除不等于隐私擦除。
- 插件不读取或保存你的模型凭据。

---

## 10. 已知限制

- 当前为 **1.0.0 稳定版**。历史报告已记录真实数据迁移/桌面升级，以及合成数据的磁盘满和 VM 断电演练；这些证据仅覆盖各自的版本与场景，不能概括成从未验收，也不能推广为当前候选所有故障均已实测。长期真实负载与跨设备场景仍有未覆盖项。
- 面向 Windows 桌面与单用户使用；未验证多用户/网络盘。
- 单作用域最多 4096 个 Markdown 文件、合计 32 MiB；单文件读取 1 MiB，写入 512 KiB。
- rc.19 起自动总结默认开启，未做真实模型成本测试。
- 已有深色主题与面板交互的开发/验收记录；完整键盘操作及无障碍覆盖仍有限，不能据局部测试宣称全面完成。
- 归档列表不分页，超大归档库性能未验收。
- 自动合并（1.0.0-rc.11 起）：同主题且相关 ≥60% 自动合并；只满足一项（同主题或相关 ≥60%）进待确认；两者都不达标不处理。词面匹配（含 rc.12 的同义词归一与子词切分）可能误并或漏并，自动合并结果可撤销但不会自动恢复。
- 人物弧光（1.0.0-rc.3）：只读视图，按主题与时间组织；不提供叙事摘要与模型生成。
- JSON 包导入（1.0.0-rc.7/rc.9）：面板支持拖拽、体积提示与两种冲突策略；单文件上限 2 MB，冲突只列名字，没有差异预览与导入历史。
- 提醒（1.0.0-rc.5/rc.8）：路由按词面匹配判断项目与歧义；`memory_reminders` 按本机时区显示，但宿主 `schedule_list` 仍可能显示 UTC。关闭/重开补投与长期运行仍未在真实桌面验证。
- 同步（v0.4.0）：只提供 CLI 与自托管中继（`sync-relay`/`sync-push`/`sync-pull`），面板无入口；默认 `127.0.0.1` + 共享 bearer token，不做 TLS 终止、每设备授权/撤销、设备发现与配对；真实跨机器传输、浏览器扩展与移动端载体未验收。
- 小鲸鱼气泡（v0.7.0）：依赖第三方挂件暴露的钩子；上游 issue #331 未接纳，**按本地长期补丁维护**。挂件升级会覆盖补丁，需用 `reapply-whale-patch.mjs` 重打；没有钩子时降级为宿主投递 + 会话内注入。
- 相关记忆与关系图（v0.7.0/v0.10.0）：启发式打分，中文只做二元组匹配，可能有误报；只读展示，不会自动合并。

---

## 11. 健康检查（可选）

源码项目内提供隔离验收入口（当前使用 Node 24；分发漏洞审计可能访问 npm，不能称为全程离线）：

```powershell
node .\scripts\verification\acceptance-suite.mjs 1.0.0 --with-host --with-concurrency
```

它会跑类型检查、构建、单元测试、打包、分发审计、许可审计、9 个存储/故障/并发步骤和 5 个宿主探针，共 22 步，结果写到 `docs/evidence/S05-1.0.0-acceptance/`。需要人工参与的隔离测试（磁盘满、断电、原生流程）见 [手动隔离测试](../progress/2026-11-05_002_需要你亲自参与的隔离测试（rc.11_候选）.md)。

---

## 12. 相关文档

- [配置说明](../configuration.md)
- [存储、迁移与恢复](../storage-recovery.md)
- [兼容性记录](../progress/2026-11-05_001_DSH_compatibility_—_current_status_and_historical_verification.md)
- [当前进度](../progress/2026-11-09_018_持久记忆_WH（dsh-auto-memory-wh）阶段总结报告.md)
- [发行前清单](../progress/2026-11-06_018_发行前门槛清单.md)

## rc.19 真实模型验证

已用 deepseek-account/deepseek-flash 和四组虚构事实验证自动生成两层记忆、同项目新会话召回详情、跨项目只召回概括。使用实际宿主服务与测试脚本调度的 memory_read，不等同于桌面 UI 自主代理全流程；未做 VM 或模型成本测量。详见 [真实模型隔离验收](../progress/2026-11-15_007_默认开启与真实模型隔离验收.md)。

## 1.0.1 合并历史

重复与合并仅列出最近三条自动合并；“查看全部合并”打开当前范围的自动、手动及历史合并浮窗，可展开查看内容。点击 ×、窗外或 Esc 关闭，窗内点击保留。旧手动记录只有来源关系，没有可可靠还原的撤销快照，因此仅供查看；现有自动合并的撤销入口继续保留。
