> 公开脱敏版：保留当时的版本、结果与限制；本机路径已泛化，原始日志/截图和私人操作记录不公开。历史描述不代表当前版本。

> 历史快照：以下状态与命令仅描述原记录时点；当前结论见[结题报告](2026-11-15_001_dsh-auto-memory-wh_结题报告（1.0.0-rc.17）.md)，发布只使用[统一发布报告](../attachments/release.md)。

# 持久记忆 WH（dsh-auto-memory-wh）阶段总结报告

- 日期：2026-11-09（Asia/Shanghai）
- 项目：`C:\Users\example-user\Desktop\dsh-plug-in\dsh-auto-memory-WH`
- 当前候选：`1.0.0-rc.17`（`.work/dsh-auto-memory-wh-1.0.0-rc.17.tgz`）
- 结论：功能线已收口，候选通过单测、隔离验收与桌面升级；**发布动作待所有者执行**，第二宿主（VM）待用 rc.17 复测。

## 1. 项目一句话

WH 是 DSH 的持久记忆插件：把会话里的事实、偏好、计划与项目状态写成 Markdown 记忆，按需注入后续会话，并提供管理面板（检索、编辑、合并、人物弧光、导入导出、档位、审计）。

## 2. 今天完成的事（rc.10 → rc.17）

| 版本 | 内容 | 关键决定 |
| --- | --- | --- |
| rc.10 | 撤销“用户审核” | 新写入与旧记录都直接注入，只排除 disputed / superseded / 停用 / 过期；面板移除批量审核与“未审核”筛选 |
| rc.11 | 合并规则重定 + `verified` 门槛修复 | 同主题且相关 ≥60 自动合并；同主题或相关任一 ≥60 只进“待确认”；都不达标不处理。导入/同步冲突改按 `updatedMs` 比较，candidate 也参与 |
| rc.12 | 词面增强 + 合并列表中文标题 | 中英同义词与带连字符名称的子词共享词元（零 token、确定性）；列表优先显示 `title` |
| rc.13 | 合并幂等 | 扫描与批量合并跳过 superseded/disabled，失效来源不再中断整批，结果提示保留 |
| rc.14 | 合并一次点击 | 去掉二次确认；来源仍标记被取代、可撤销 |
| rc.15 | 导出与归档修复 | “导出 JSON 包”由 GET 改 POST（此前恒定报“无法识别的响应”）；“移至归档”确认改行内显示 |
| rc.16→rc.17 | 编辑器收起 | 保留“查看 / 编辑：取消”；rc.16 的“点空白退出”因误触多于便利，已在 rc.17 移除 |

## 3. 交付物与验证

- 单元/集成：**60 个测试文件、630/630 通过**；`tsc --noEmit` 通过；`tsdown` 构建通过。
- 候选包：202,812 字节，SHA-256 `eedf90ac237567df47f4e37d0d57bb68a2e8179a00be45f1e43869ba74aeb6ec`，shasum `9497b9452b5081f14bcfd3a1367e0065b32073ac`。
- `lib/index.js`：260,595 字节，SHA-256 `3402a81cb8538a78cbdfb62441e3d90ef4a988a98b6707e3eae94dacf9a4a556`。
- 隔离 `wh-s05` 全套验收：**22/22 PASS**（`docs/evidence/S05-rc17-acceptance/summary.json`）。
- 日常桌面升级：`rc.16→rc.17` **7/7**（was、bundle、dependency、version、lib-sha、memory-unchanged、bundles-preserved），31 条 user scope 记录（`docs/evidence/S05-real-data-migration/desktop-upgrade-1.0.0-rc.17.json`）。
- 发布门禁：`release-readiness.mjs` 在 rc.17 上复跑 **12/12 READY**（许可、发布文档、包内容、候选证据、npm 包名）。

## 4. 为什么这样定

- **撤销审核**：记忆的目的是省事；强制审核把成本又推回用户。状态默认值不动（避免 reviewHash 迁移），只改注入与任务可提醒的过滤条件，风险最小。
- **合并规则**：只满足“同主题”或“相关”一项时误并风险高，所以只询问；两项都满足才自动。相关阈值 60 与同主题 60 对齐，规则可解释。
- **冲突按 `updatedMs`**：只有“内容不同且本地更新”才算冲突，避免正常同步天天冲突，又不静默覆盖本地新改动。
- **词面增强而非 embedding**：零 token、可离线、确定性；先解决“考研/研究生考试”“memory-wh/memory”这类明显漏配，语义评估留给 1.7 P4。
- **导出必须 POST**：服务端 `export.package` 是 POST-only；客户端漏传 method 导致 404 HTML，用户看到的就是“无法识别的响应”。这是本轮最典型的“客户端与路由契约不一致”缺陷，已补回归测试。

## 5. 已知限制与未覆盖

- VM（portable DSH 0.2.1-rc.5）目前只验到 rc.14：安装、升级、回退通过；导出 bug 是在 rc.15 修的，**rc.17 的导出/归档/编辑器收起尚未在 VM 复测**。
- VM 是新 profile，`memory-wh` 不存在，升级前后摘要只能是 `memory-wh absent`，属弱证据；强证据在主机桌面（31 条真实记录，7/7）。
- 相关性仍是词面打分；同义词典只覆盖常见词，专业术语可能漏配。
- 1.7 P4（跨主题语义合并 + 审计环）未做；跨主题仍只到“待确认”。
- 1.3 第二刀（低相关性先询问“本会话还是新开会话”）未做；archived 分支未在工具层真实触发。
- 1.2 可选项（导入历史、冲突差异预览、真实第二设备 relay）未做。
- GitHub Release 若走本机 git 会因仓库属主 `Tony/CodexSandboxOnline` 与当前用户 `TONY/example-user` 不符而报 dubious ownership；建议网页发布，或先解决属主。
- 至少 1 个月真实提醒与真实关闭/重开补投演练仍未做。

## 6. 剩余事项（按优先级）

1. **VM 用 rc.17 复测**：安装 → 重开 → 版本/哈希核对 → 导出 JSON 包 → 移至归档（行内确认）→ 编辑器收起 → 拖入 `111` 的无效包提示。
2. **发布**（所有者执行）：
   - `npm.cmd login`
   - `npm.cmd publish .work\dsh-auto-memory-wh-1.0.0-rc.17.tgz --tag next --dry-run`
   - 正式 publish → `npm view dsh-auto-memory-wh@next version`
   - GitHub 网页 Draft release，tag `v1.0.0-rc.17`，勾 pre-release，附 tgz
3. 第二宿主兼容结论写入发布说明（第二宿主 = VirtualBox Win10 + portable DSH 0.2.1-rc.5）。
4. 后续版本：1.3 第二刀 → 1.2 可选 → 1.7 P4 → 1.1 剩余；长期做真实提醒与补投演练。

## 7. 快速核对命令

```powershell
# 版本与哈希
(Get-Content "C:\Users\example-user\.dsh\profiles\desktop\node_modules\dsh-auto-memory-wh\package.json" -Raw | ConvertFrom-Json).version
(Get-FileHash "C:\Users\example-user\.dsh\profiles\desktop\node_modules\dsh-auto-memory-wh\lib\index.js" -Algorithm SHA256).Hash

# 重新打包后的候选哈希
(Get-FileHash ".work\dsh-auto-memory-wh-1.0.0-rc.17.tgz" -Algorithm SHA256).Hash
```

## 8. 相关文件

- 阶段报告索引：[docs/progress/README.md](README.md)
- 当前状态：[docs/current-status.md](2026-11-09_018_持久记忆_WH（dsh-auto-memory-wh）阶段总结报告.md)
- 交接单：[PROJECT-HANDOFF.md](../attachments/backup-handoff.md)
- 发布说明：[docs/release-notes-1.0.0.md](../attachments/release.md)
- 用户指南：[docs/user-guide.md](../attachments/user-guide.md)
- 路线图：[docs/roadmap.md](../attachments/roadmap.md)
- 本轮细节：[r204](2026-11-09_017_移除“点空白退出”.md)

## 整理说明

原 current-status.md 和 PROJECT-HANDOFF.md 中重复的当前状态、逐版本进度与发布待办合并到本总结及现行结题/发布报告；逐版依据仍在 CHANGELOG 与阶段报告。交接中的私人备份、恢复、项目地图与排错内容独立保留在[备份与交接附件](../attachments/backup-handoff.md)。本总结仍反映 11-09 的历史状态，不覆盖 11-15 VM 复测结论。
