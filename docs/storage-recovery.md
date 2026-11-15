> 版本边界：正文含历史设计/演练记录，不能视为全部适用于 rc.17 的现行行为。rc.17 取消人工审核门槛，新提醒使用宿主 scheduler；当前状态见结题报告，发布条件见 docs/attachments/release.md。

# 存储、迁移与恢复（S03 / 0.1.0-alpha.0）

本说明对应隔离开发版。所有示例只用于合成目录。真实数据切换仍需完成存储和迁移门槛，并针对具体计划取得授权；本阶段没有安装插件或访问用户记忆。

## 1. 当前数据布局与边界

默认根仍为宿主解析的 `DSH_HOME/memory-wh`。普通文件记录继续使用上游 Markdown/frontmatter 格式。

```text
memory-wh/
  .wh-format.json                 # WH 格式标记，version: 1
  .wh-writer.lock                 # 写入期间存在；崩溃后可能残留
  _user/                         # 用户作用域
    example.md
    MEMORY.md                    # 可重建的索引
    .wh-transaction.json         # 未完成事务的恢复日志
    .archive/<uuid>.json          # 删除前的原始文件字节、校验值和时间
    .backups/<uuid>.json          # 批量修改前的作用域快照
  --project-slug--/
    .wh-project.json             # 完整项目路径，检测 slug 碰撞
    ...
  audit.jsonl                    # 继承的注入审计；不是事务日志
```

`MemoryStore` 只会自动初始化新根或空根。已有非空、无 WH 标记的目录拒绝写入，需先迁移。未知根格式版本拒绝写入。仅把 `memoryDir` 指向旧库不等于完成迁移。

项目目录仍沿用上游编码，但首次 WH 写入会绑定完整项目路径；其他路径碰撞到同一目录时拒绝读写。迁移旧项目目录必须提供路径映射，不能从 slug 猜原路径。映射文件含本地路径，不应对外公开。

单记录文件读取上限 1 MiB，写入参数序列化后上限 512 KiB；每个作用域事务最多 4096 个 Markdown 文件、合计 32 MiB。完整盘点最多 4096 个文件清单项、32 MiB 字节，遍历深度和总目录项也有限制。超限拒绝处理，不截断正文。归档自身也受维护文件大小限制，因此接近单文件上限的手工旧文件应先单独评估；该版本不是无限规模存储。

## 2. 写入与中断恢复

WH 使用整个数据根的写锁，再取得作用域索引锁。普通写入、读取计数、索引刷新、删除和归档恢复采用同一规则。根锁降低并发吞吐，但使维护快照与 WH 写操作互斥。

每次修改先保存该作用域所有活动 Markdown 文件的原始字节、大小和 SHA-256，写入 `prepared` 日志。完成记录和索引变更并刷写文件后，日志改为 `committed`，最后清理日志。

| 中断位置 | 恢复规则 |
|---|---|
| prepared，尚未提交 | 恢复原活动文件，移除事务新增的活动文件及本事务新建的归档 |
| committed，未完成清理 | 保留新状态，清理事务日志 |
| 日志损坏或恢复本身失败 | 保留日志和文件，拒绝读取/注入未确认的作用域，要求维护处理 |
| 子进程突然退出留下锁 | 先停写并检查锁，再显式释放已确认死亡进程的锁，之后恢复事务 |

普通读取遇到写锁或恢复日志会报告忙碌/待恢复；Prompt 索引读取在该期间返回空段，避免注入事务中间状态。日志中的正文是敏感数据；日志不属于公开诊断输出。

记录提供原始字节哈希 `revision`，调用存储写入时可传 `expectedRevision`。锁内校验失败即拒绝覆盖。该能力已在存储层测试；完整 UI 编辑流程接入、所有调用者的版本检查和用户冲突提示留待 S04。没有传版本的旧调用者仍是显式覆盖写入语义，不能据此宣称所有更新已消除冲突。

文件内容在提交前执行同步刷写；目录刷写在平台支持时执行。Windows 不一定支持目录 fsync。本阶段验证了进程中断和注入故障，没有验证物理断电、控制器缓存或网络文件系统，不承诺断电情况下零丢失。

## 3. 删除、批量修改与恢复

`memory_delete`、条件删除、`memory_prune` 和 `memory_delete_all` 已改为归档删除。归档保留删除前的完整原始字节、未知元数据、信任状态和关系。活动索引与列表不扫描 `.archive/`。

批量清空和修剪在每个作用域内执行一个事务，并先写入该作用域的快照。修剪在锁内重新判断记录年龄，避免用过时列表直接删除已更新的记录。任一文件失败会回退该作用域；跨用户/项目两层的批量请求仍由两个作用域事务组成，不是跨作用域原子事务。

归档恢复不覆盖当前同名文件，也不消费归档；重复恢复会报告冲突。损坏归档需人工审查，不能自动“修好”后恢复。批量快照可通过 `scope-backups` 列出，并使用普通 `verify` / `restore` 流程恢复到新目录。

软删除不是隐私擦除。归档、旧快照和外部副本仍可能保留内容。本版本没有永久擦除命令、定时保留策略、自动清理或云上传；不会自动删除唯一恢复点。后续可以实现最近 10 个快照加迁移基线的保留策略，但目前未实现。备份未加密，Unix 文件 mode 不等于已经核验 Windows ACL；磁盘损坏还需要用户另行维护异盘副本。

## 4. 维护入口

入口是项目构建出的独立 Node 程序，不是 DSH 子命令，也不是模型可调用的工具：

```powershell
node .\lib\maintenance-cli.js --help
node .\lib\maintenance-cli.js <命令> <请求文件.json>
```

本机已用 Node 24.22.0 测试。涉及 DSH 版本/插件安装的核验仍使用内置 `C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，不使用 PATH 上旧的全局 `dsh`。

请求文件是本地 JSON，结果写到标准输出，失败返回非零退出码。`inventory` 和 `plan` 本身不创建任何源/目标目录或锁；若把输出重定向保存，那个输出文件是调用方主动保存的计划文件。

| 命令 | 请求字段 | 效果 |
|---|---|---|
| inventory | source、selection | 只读清单、异常和哈希 |
| plan | source、target、backup、selection、可选 projectMappings | 只读迁移计划、阻塞项、计划哈希 |
| apply | plan（完整对象）、options.approvedPlanHash、options.writersStopped | 核验计划，备份、恢复演练、生成独立迁移目标；不切换 DSH 配置 |
| backup | source、destination、selection、writersStopped、可选 hostBuild | 创建全库所选内容快照；目标目录必须不存在 |
| verify | file、expectedHash | 验证快照版本、文件路径、大小及逐文件哈希 |
| restore | file、expectedHash、destination、可选 projectMappings | 恢复到新目录并重建索引 |
| archive-list | root、scope、项目作用域所需 cwd | 列出归档 ID、原文件名、时间、哈希 |
| archive-restore | root、scope、cwd、id、writersStopped | 恢复一条归档，同名拒绝覆盖 |
| scope-backups | root、scope、项目作用域所需 cwd | 返回批量操作前快照的文件位置和 SHA-256 |
| recover | root、writersStopped | 恢复各作用域残留事务；残留锁需先处理 |
| unlock | root、lock（根内相对路径）、expectedHash、writersStopped | 仅释放内容匹配且进程已确认不存在的已知写锁 |
| projects | root | 只读列出项目 scope 的 cwd、记录数与最近修改时间 |
| project-remap | root、fromCwd 或 fromDirectory、toCwd、writersStopped | 项目目录改名/换机后重写映射；目标已存在时拒绝，不做隐式合并 |
| project-merge | root、fromCwd/fromDirectory、intoCwd/intoDirectory、writersStopped、可选 skipIdentical | 把来源 scope 的未冲突记录并入目标；同名不同字节拒绝，最后删源 |
| project-archive | root、fromCwd 或 fromDirectory、writersStopped | 把整个项目 scope 移到 `_archive/projects/` 保留，盘点不再显示 |
| transfer-export | root、scope、out | 导出 `wh-memory-export` v1 包（含校验和） |
| transfer-plan | file、root | 预览导入将创建/更新/跳过/冲突的记录 |
| transfer-apply | file、root、approvedChecksum | 应用导入；目标记录一律写为 candidate，冲突默认拒绝 |
| sync-changes | root、scope、deviceId、out，可选 stateFile/since | 导出毫秒游标变更集（更新 + 归档删除）及校验和 |
| sync-apply | root、file、approvedChecksum，可选 stateFile/onConflict | 应用变更集并推进游标；已验证内容冲突默认不覆盖 |
| sync-init | file | 生成设备身份（Ed25519 签名 + X25519 加密，私钥本地明文 JSON） |
| sync-trust | trustFile、action（add/remove/list）、deviceId 等 | 维护同步信任列表 |
| sync-seal | file、identityFile、trustFile、recipient、out | 签名并加密变更集为 `wh-sync-envelope` |
| sync-open | file、identityFile、trustFile、out | 校验信任/签名/收件人后解封变更集 |
| sync-push | root、scope、identityFile、trustFile、relayUrl、token、recipient，可选 stateFile/cwd | 取 `sentCursor` 之后的增量、封装并投递到中继；成功后才推进发送游标 |
| sync-pull | root、scope、identityFile、trustFile、relayUrl、token，可选 stateFile/cwd/limit/onConflict | 拉取本设备队列、逐条应用，只确认成功的消息 |
| sync-relay | root、token，可选 host/port/retentionMs | 启动 `wh-sync-relay` HTTP 中继（默认 127.0.0.1、随机端口）；SIGINT/SIGTERM 停止 |

`selection` 必须明确包含 `includeAudit` 和 `includeArchive` 两个布尔值；没有隐含“把所有历史一起导出”。完整备份包含全部已识别作用域；单作用域批量快照通过 `scope-backups` 获取。配置文件和未知文件会被盘点并阻塞维护流程，不会悄悄打包密钥。`.backups/` 不递归进入快照，避免备份自己；此排除出现在清单中。

`writersStopped: true` 是操作者确认已停止所有写入者，不是程序可以证明宿主已停止。程序还会取得 WH 根锁、现有各作用域索引锁和审计锁；与不遵守这些锁的外部程序不构成强制隔离。真实切换前须停用旧插件与其他写入者。

## 5. 迁移操作顺序

1. 停留在只读盘点阶段，明确源根、独立目标、独立备份和包含范围。三者不能相同或互为子目录，目标和备份的父目录须已存在。
2. 生成计划。检查合法记录、索引、审计、归档、排除项、坏文件、未知文件和映射。所有阻塞项必须处理后重新生成计划，不能手工删掉 `issues` 来绕过；改动任何计划内容都会使哈希不匹配。
3. 保存并审查完整计划及其 hash。针对真实数据另行确认具体计划。停止所有写入者后执行 `apply`，请求中的 `approvedPlanHash` 必须与已审查计划一致。
4. 执行前重新核对源清单。备份写出后验证校验值；在备份目录的 `restore-rehearsal/` 还原所有选择的原始字节，包括旧索引，证明备份可读。
5. 在目标同级的 staging 写入新库，保留记录字节；补充 WH 格式/项目映射文件并从记录重建索引。目标文件验证通过后，同目录重命名提交到全新目标。
6. 结果只表示“独立副本已准备并验证”，不会自动设置 memoryDir、启用插件或修改 DSH。后续隔离安装、跨会话检索、UI、审批和代码/配置切换演练仍需单独完成。

计划中的 `projectMappings` 是“现有 slug → 原始绝对项目路径”的对象；提供的路径必须重新编码为同一 slug。无法确认原路径时停止，不能凭名称猜测。

迁移日志位于目标同级 `目标路径.migration-<id>.json`，记录计划哈希、备份哈希、阶段及预期目标清单哈希。相同计划可在备份后、staging 完成后、重命名后继续；遇到额外文件、不同内容、损坏日志或源变化时停止并保留现场。已完成计划重复执行返回已完成，不覆盖目标中新写入的数据。该返回值不是对后来新写入内容的重新验收。

SHA-256 检查用于内容一致性，不能替代来源认证或数字签名。应单独保留已确认的备份哈希；不要在发现备份损坏后直接重新计算外层哈希当作修复。

## 6. 回滚与锁恢复

恢复命令始终使用全新目标，并拒绝与快照源重叠。它不会直接覆盖当前库。真实回滚前先停写、为当前库生成新的快照，列出旧恢复点之后的新增/修改记录；保留当前库，再决定代码、配置和数据的切换。恢复点之后的写入不会自动合并，也不能默默丢弃。

残留锁处理前检查其内容和 SHA-256。`unlock` 只接受 `.wh-writer.lock`、`audit.jsonl.lock` 或已知作用域的 `MEMORY.md.lock`。活跃 PID、权限不足、无法识别的内容或变动的哈希均拒绝释放。PID 可能复用，工具宁可拒绝，也不会把权限错误视为进程已死亡。停写确认是必要前提，文件锁不防同权限恶意进程竞态。

恢复失败时保留源、备份、staging 和日志，不再写入该库。没有自动清理 staging/备份的命令；确认恢复成功后再人工制定清理范围。插件卸载不调用数据清理。

## 7. 已验证与仍待验证

S03 合成测试覆盖进程突然退出、多进程写入、锁错误、提交前/后中断、回退失败后再恢复、归档与批量快照恢复、过时版本冲突、项目碰撞、Windows junction、路径/设备名、坏记录/未知格式、源变化、迁移重复与中断、坏快照、恢复覆盖拒绝、模拟磁盘不足和权限错误。

完整宿主安装/UI/审批、真实授权副本、实际断电/物理磁盘满、Windows ACL、网络盘、所有 UI/API 的范围与版本强制校验、完整信任/逐次审计和性能目标仍待后续验证。现有路径检查会反复检查链接与打开的文件身份，但不是防御同权限恶意进程替换目录的内核级保证。不能将本阶段结果当成 G2/G3 全部通过。
