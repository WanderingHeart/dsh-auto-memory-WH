> 版本边界：正文含历史设计/演练记录，不能视为全部适用于 rc.17 的现行行为。rc.17 取消人工审核门槛，新提醒使用宿主 scheduler；当前状态见结题报告，发布条件见 docs/attachments/release.md。

# WH v1.0.0-rc.2 架构与数据边界

更新：2026-11-07。本页描述当前代码和已验证边界；[旧设计草案](design.md)保留为历史资料，不用来判断当前实现状态。

```text
DSH Desktop / Cordis
  ├─ 工具与会话事件 ──> WH 入口 src/index.ts ──> 五工具 src/tools.ts
  ├─ Prompt 组装 ────> src/injection.ts ──────> 审计 src/audit-log.ts
  │                        └─ 任务提醒段 src/tasks.ts（每会话去重）
  ├─ 认证连接 ────────> 管理 API src/management-api.ts ──> 管理页 src/client/
  │                        └─ schedule.status
  └─ 可选宿主调度 ────> src/schedule-bridge.ts ──> ctx.get('schedule', false)
                              │                      （sidecar: schedule-bridge.json）
                              ▼
                        MemoryStore src/store.ts
                              │
               src/storage-safety.ts：路径、锁、事务与恢复日志
                              │
                       DSH_HOME/memory-wh

离线维护：src/maintenance-cli.ts ──> src/maintenance.ts
          （盘点、迁移计划、备份、验证、恢复；不切换 DSH profile）
```

## 启动与范围

`src/index.ts` 解析配置、拒绝已有记忆工具冲突，并用宿主 `resolveDshHome()` 找到默认的 `memory-wh` 根目录。`src/project-context.ts` 从当前有效会话取得项目工作目录；没有有效目录时不猜测 `process.cwd()`。用户级和项目级记忆各自有作用域，项目目录绑定原绝对路径以检测名称碰撞。

WH 注册五个 `memory_*` 工具、Prompt 段、会话事件和管理 API。管理 API 依赖宿主认证检查，项目请求还需由活跃会话解析项目目录；请求自带的路径不能直接选择其他项目。页面只调用该 API。宿主若未提供所需认证接口，API 拒绝服务。

## 写入、读取与恢复

单条记忆是 Markdown 文件，派生索引为 `MEMORY.md`。新记录写入后即可进入注入索引；只有 disputed、superseded、停用或过期的记录被排除。注入预算按最终 UTF-8 字节计算，审计标记为 `render_attempt`，不能证明模型最终收到或采纳了这段文字。

`MemoryStore` 通过根锁与作用域锁串行化 WH 写入；事务在改写前保存原始字节与哈希，提交前刷写修改文件。未提交日志恢复旧状态，已提交但未清理的日志保留新状态；读取遇到未完成事务会封闭。删除进入归档，批量操作先保留快照。离线维护程序只向新目标迁移或恢复，不自动修改宿主配置，也不直接覆盖当前库。细节与故障限制见[存储恢复说明](../storage-recovery.md)。

## 任务与提醒（v0.5.0）

任务是 `type: 'task'` 的记忆，额外字段 `dueAt`/`remindAt`/`priority`/`taskStatus` 与正文一起存在 Markdown frontmatter 里，仍走同一条 candidate 记录链路（1.0.0-rc.10 起注入不再需要审核）；任务字段不参与内容指纹，改期不改变信任状态。`src/tasks.ts` 负责字段校验、分桶（逾期/到期/临近）、排序与每会话去重。

`src/index.ts` 在 Prompt 组装时注册第二个段（`memory-wh:tasks`），只读取 user/project 两个作用域的 source records，不读缓存索引；渲染由 `src/injection.ts` 完成，任何异常都被吞掉并清空该段，不影响对话。

`src/schedule-bridge.ts` 是可选投递层：通过 `ctx.get('schedule', false)` 检查宿主是否提供调度服务；有则把 open + verified 的任务 create/update 到宿主（`target: new_once`，标题 `记忆提醒：…`，正文带 `[memory-wh] task=` 标记），并在 `schedule-bridge.json` 里维护 task → scheduleId 与签名，用于幂等、改期、删除和启动对账；无服务或调用失败时只记录状态并降级为会话内注入。桥接只清理带双标记的宿主任务，不碰用户自建调度；宿主 `schedule.json` 不属于 WH 的备份范围。

## 已验证与尚未验证的接缝

隔离 CLI、打包宿主服务、实际 HTTP 认证、Web 管理页、合成会话与假模型路径均有阶段证据；正常用户空白原生桌面窗口已启动，但 WH 的桌面 profile 安装与页面链路尚未通过。合成恢复不能推导出物理断电保证，CLI profile 的结果不能代替桌面 profile 安装。当前兼容判断以[兼容性记录](../progress/2026-11-05_001_DSH_compatibility_—_current_status_and_historical_verification.md)和[发行前清单](../progress/2026-11-06_018_发行前门槛清单.md)为准。
