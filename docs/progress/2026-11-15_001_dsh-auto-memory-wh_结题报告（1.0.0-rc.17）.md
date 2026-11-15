> 公开脱敏版：保留当时的版本、结果与限制；本机路径已泛化，原始日志/截图和私人操作记录不公开。历史描述不代表当前版本。

> 最新发布准备见 [r207](2026-11-15_003_rc.17_最终发布准备（未发布）.md)：已重新冻结并通过全部本轮检查，尚未发布。本文原候选哈希与早期验收描述保留其历史边界。

# dsh-auto-memory-wh 结题报告（1.0.0-rc.17）

日期：2026-11-15
状态：**功能线收口；VM 人工验收已记录；文档已整理，最终产物与账号条件待收尾**
候选：`.work/dsh-auto-memory-wh-1.0.0-rc.17.tgz`

---

## 1. 项目目标与结论

目标：为 DeepSeek Harness 提供一个**独立、可审计、基础检索和词面合并不额外调用模型**的持久记忆插件，覆盖写入、检索、注入、提醒、管理面板与跨端迁移，并在真实桌面与第二宿主上验证。

结论：

- 从 `0.1.0-rc.1` 迭代到 `1.0.0-rc.17`，功能与质量门槛全部达成；
- 单测 **60 文件 630/630**、类型检查与构建通过；
- 隔离 22 步验收在 rc.17 上 **22/22 PASS**（含宿主探针），并在 DSH 升级到 **0.2.2-rc.3** 后复跑仍 **22/22**；
- 真实桌面 31 条记忆升级 `rc.16→rc.17` **7/7**，`memory.before === memory.after`；
- 第二宿主（VirtualBox Win10 + DSH 0.2.1-rc.5）安装、面板、升级回退通过；
- 发布就绪检查 **12/12 READY**。

功能验收完成不代表账号和分发物已经具备全部发布条件。2026-11-15 发布前复核发现旧文档冲突，已整理修订；最终包须重新打包验收并冻结，账号认证与可选 GitHub 仓库仍需发布者核对。详见[统一发布报告](../attachments/release.md)。本次未发布。

---

## 2. 交付物

| 交付物 | 位置 |
| --- | --- |
| npm 候选包 | `.work/dsh-auto-memory-wh-1.0.0-rc.17.tgz`（202,812 字节） |
| 发布说明 | `docs/attachments/release.md` |
| 用户指南 | `docs/attachments/user-guide.md` |
| 配置说明 | `docs/configuration.md` |
| 架构说明 | `docs/attachments/architecture.md` |
| 质量与信任 | `docs/attachments/memory-quality.md` |
| 同步协议 | `docs/attachments/sync-protocol.md` |
| 阶段报告 | `docs/progress/`（历史 r1–r204，补充 r205–r206） |
| 发布步骤 | `docs/attachments/release.md` |
| 日常交接 | `docs/attachments/backup-handoff.md` |
| 当前状态 | `docs/progress/2026-11-09_018_持久记忆_WH（dsh-auto-memory-wh）阶段总结报告.md` |

候选校验：

- SHA-256：`eedf90ac237567df47f4e37d0d57bb68a2e8179a00be45f1e43869ba74aeb6ec`
- shasum：`9497b9452b5081f14bcfd3a1367e0065b32073ac`
- `lib/index.js`：`3402a81cb8538a78cbdfb62441e3d90ef4a988a98b6707e3eae94dacf9a4a556`（260,595 字节）

---

## 3. 能力清单（最终形态）

### 3.1 记忆模型

- 当前新增记忆使用 `user`、`reference`、`feedback`、`project`。底层保留旧 `task` 数据兼容字段，但 `memory_write` 拒绝新建 task；新提醒使用宿主原生自动化任务。
- 状态：`candidate`（自动记录）、`verified`（系统确认）、`legacy`（旧记录）、`disputed`、`superseded`。
- **无人工审核环节**：新写入与旧记录直接参与注入，只排除 disputed / superseded / 停用 / 过期。
- 主题：写入时按注册表词面匹配自动归类，未命中落“未归类”；面板可改。

### 3.2 注入

- 每轮请求注入记忆索引（标题 + 摘要），预算 `maxBytes`（默认 4 KB，当前桌面配置 8 KB 以容纳 33 条全量）。
- 正文不注入，按需 `memory_read`；只读、可审计。
- 新提醒不进入记忆库与记忆备份/同步；旧 task 数据兼容机制不能当作新提醒的存储承诺。

### 3.3 工具

`memory_write`、`memory_read`、`memory_delete`、`memory_search`、`memory_list`、`memory_remind`、`memory_reminders`（本地时区视图）等七个工具；提醒落点支持相关性路由（默认本会话、命中其他项目改投 `new_once`、歧义时询问）。

### 3.4 管理面板

- 列表、类型筛选、新建/编辑/归档（行内确认）、置顶；
- 重复检测与合并：同主题且相关 ≥60% 自动合并；只满足一项（同主题或相关 ≥60%）进“待确认”；两者都不达标忽略；**点击即执行，无二次确认**；
- 关系图、人物弧光（按主题成章、章内时间序、跨 scope）；
- JSON 包导出/导入：导入先只读预演，冲突可选“保留本地”或“两边都留”；
- 拖拽导入、2 MB 上限、无效包可理解提示；
- 合并/导入结果行在操作后保留。

### 3.5 跨端与恢复

- 导出包与同步变更集携带 `topic`；
- 冲突保留双方（fork）：远端版本另存为独立版本，本地不动；
- 自动备份、快照、审计、故障演练（只读/权限/锁/中断）均有覆盖。

---

## 4. 验证证据

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 单元/集成 | 60 文件 **630/630** | vitest 输出 |
| 类型检查 / 构建 | 通过，`lib` 哈希可复现 | `tsc --noEmit`、`tsdown` |
| 隔离验收（rc.17） | **22/22 PASS** | `docs/evidence/S05-rc17-acceptance/summary.json` |
| 新宿主复跑（DSH 0.2.2-rc.3） | **22/22 PASS** | 同上（2026-11-15） |
| 桌面升级（rc.16→rc.17） | **7/7**，31 条记录，摘要不变 | `docs/evidence/S05-real-data-migration/desktop-upgrade-1.0.0-rc.17.json` |
| 第二宿主（VM） | 安装/面板/升级回退通过 | 本文 §5 |
| 发布就绪 | **12/12 READY** | `docs/evidence/S05-release/release-readiness.json` |

---

## 5. VM 第二宿主验收记录

环境：Oracle VirtualBox 7.1.4，Windows 10 64 位，4 GB / 2 CPU，DSH **0.2.1-rc.5**（portable），插件 rc.17。

| 项 | 结果 |
| --- | --- |
| 安装 rc.17 | 通过；version `1.0.0-rc.17`，lib `3402A81C…A556`，tgz `EEDF90AC…B6EC` |
| 导出 JSON 包 | 通过（修复 POST 后不再报“无法识别的响应”） |
| 导入预演 | 通过（空 profile：0 条、295 字节、校验和正常） |
| 无效包 `111` | 通过（提示“不是 WH 记忆包/没有 records 列表”） |
| 归档 / 编辑器 / 合并 | 通过（行内确认、取消按钮、无二次弹窗） |
| 升级回退 rc.16→rc.17 | 通过；`Compare-Object` 无输出，版本/哈希回到 rc.17 |

边界：

- 原结题文字称 VM 摘要为 `memory-wh absent`；本次只读查看共享目录的 memory-before.txt / memory-after.txt，文件中已有 WH 格式标记、单条记录与归档条目，且两文件逐字节相同。该文件没有候选版本/时间的完整绑定，不能独立证明 rc.17 全链验收；VM 功能结论仍注明来自既有人工验收记录，不将少量测试数据扩写成真实多记录迁移验证。
- 提醒补投、双机 relay 未在 VM 做（需登录模型/Internal Network），登记为未覆盖项。
- VM 的 DSH 比主机旧一个小版本，正好覆盖“最低支持版本”。

---

## 6. 已知限制

1. 相关性判断基于词面（含同义词与子词增强），不做 embedding；语义相近但用词差异大的记忆可能漏配。
2. 跨主题合并仍坚持人工确认；P4 的“语义评估 + 审计环”未实现。
3. 1.3 第二刀（低相关性先询问）未做，目前只在“同时命中本会话与其他项目”时询问。
4. 导入历史、冲突差异逐字段预览未做。
5. 第二台真实设备 / 真实 relay 未联调。
6. 真实提醒仅 1 天样例；≥1 个月长期观察仍待做。
7. 面板是 Web 视图，移动端未适配。
8. 55 个构建期依赖无许可文件（`@rolldown/*`、`@yuku-*`、`lightningcss-*` 等），不进入发布包，属审计登记项。
9. 小鲸鱼气泡依赖本地补丁（上游 issue #331 自 2026-11-07 起未回复，已决定按本地长期补丁维护）；挂件升级需用 `reapply-whale-patch.mjs` 重打，失败时自动降级。

---

## 7. 发布状态

- 候选已冻结：`.work/dsh-auto-memory-wh-1.0.0-rc.17.tgz`
- 本次 npm 公共 registry 返回 E404；尚未发现公共包，名称和账号发布权限仍须发布时确认
- 发布步骤见 [release-steps.md](../attachments/release.md)
- 回退包：`.work/dsh-auto-memory-wh-1.0.0-rc.16.tgz`（202,784 字节，`4a8418c0…0b4a`）

---

## 8. 后续路线

- 发布 rc 线（`next`），观察 2–4 周；
- 1.3 第二刀：低相关性先询问；
- 1.2 可选：导入历史、冲突差异预览、真实第二设备；
- 1.7 P4：跨主题语义合并（默认关闭、可撤销、审计）；
- 1.1 剩余：自动总结默认策略、来源会话/设备标注；
- 长期：≥1 个月真实提醒、关闭/重开补投演练。

---

## 9. 安装 / 回退

安装：

```powershell
& 'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<tgz 绝对路径>' --ignore-scripts
```

回退：

```powershell
& 'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<rc.16 tgz 绝对路径>' --ignore-scripts
```

安装后完全退出并重开 DSH。

## 10. 本次复核边界（2026-11-15）

本次检查源文件、候选包、已留存证据与 npm 公共名称状态，未重做 VM/真实数据迁移，未登录或发布。旧 12/12 证据时间为 11-09；11-15 的 22 步验收对应旧冻结包。本次文档更新使旧 tgz 与工作区分发文档不同，必须在实际发布前重新冻结最终产物。

## 当前说明校正

会话总结会调用宿主模型，不应把整个插件写成零模型调用；当前面板无静音/状态筛选/手动标记被取代入口，状态标签与旧 disabled 字段仍在底层。类型分类和用户级/项目级 scope 不等同。最新核查见 2026-11-15 的功能文档核对报告。
