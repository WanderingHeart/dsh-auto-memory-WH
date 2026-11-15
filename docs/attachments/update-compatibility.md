> 版本边界：正文含历史设计/演练记录，不能视为全部适用于 rc.17 的现行行为。rc.17 取消人工审核门槛，新提醒使用宿主 scheduler；当前状态见结题报告，发布条件见 docs/attachments/release.md。

# DSH 更新兼容性：策略与恢复 Runbook

- 日期：2026-11-06
- 适用：本插件（`dsh-auto-memory-wh`）在任何 DSH 版本上的装载、升级与恢复
- 关联：[用户指南](user-guide.md)、[当前进度](../progress/2026-11-09_018_持久记忆_WH（dsh-auto-memory-wh）阶段总结报告.md)、[路线图](roadmap.md)、[发布流程](release.md)

## 1. 目标（所有者 2026-11-06 确认）

1. **非破坏性更新**：DSH 升级后插件不应消失，旧版本继续工作，等插件更新后再适配新能力。
2. **破坏性更新**：记忆数据绝不损坏；允许插件入口短暂不可用，但必须可诊断、可恢复。
3. **不做**：不自动审核、不静默迁移、不删除任何记忆；恢复动作必须可解释。

## 2. 机制（为什么插件会“消失”）

DSH 在启动时对 profile 里的每个 bundle 做兼容检查（`@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility`）：

- 插件声明了 `engines.dsh` 时，**只**按该范围判断；没有声明时，逐个检查 `@deepseek-ai/dsh-*` peer 版本。
- 任一条件不满足时，整个 bundle 被 **跳过**（`skippedBundles`），并写入启动日志：
  `dsh: skipping profile bundle "dsh-auto-memory-wh": ... incompatible with dsh <version>`。
- 跳过 ≠ 卸载：profile 的 `package.json`、依赖目录、`memory-wh` 数据都还在；恢复后入口直接回来。
- 宿主还支持**精确版本豁免**：`compatibility.json` 里以 `包名@版本` 为键记录“允许在哪些运行时版本上装载”。豁免只对精确版本生效，属于显式风险接受。

因此：

- “更新就掉”的直接原因是兼容范围比宿主新版本窄，而不是数据或安装被破坏。
- 想“非破坏性更新不掉”，唯一自动的办法是让 `engines.dsh` 覆盖已知兼容区间；
- 想“破坏性更新不丢数据”，靠的是数据与插件解耦 + 恢复路径，不需要放宽范围。

### 插件侧的自我保护（启动自检 + 降级）

即使宿主放行、但某个插件面 API 被改名/移除，插件也不会“半注册”后静默失败：

- `apply` 最先调用 `src/compat.ts` 的 `inspectCapabilities`，只做 `typeof` 级检查（`tools.register`、`systemPrompt.section`、`ctx.on/effect/inject`，以及存在 web 连接时的 `connection.fetch.register`/`requestRejection`）。
- 一旦发现缺口，不启动记忆引擎、不触碰 `memory-wh`，只注册：
  - 只读工具 `memory_wh_compat`（返回缺失能力与处理建议）；
  - 只读路由 `/api/auto-memory-wh/compat.status`（面板所在连接可用时）。
- 日志会明确写 `compatibility self-check failed; memory engine not started`，便于下次直接定位，而不是看到侧栏空白去猜。

## 3. 本插件的声明窗口

`package.json`：

```json
"engines": { "dsh": ">=0.2.1-rc.5 <1.0.0" }
```

- 下限：已在本地实测过的最早宿主（`0.2.1-rc.5`）。
- 上限：`<1.0.0`。DSH 仍在 0.x，0.3/0.4 可能包含破坏性变更；窗口在“更新不掉”和“别把明显不兼容的宿主放进来”之间取平衡。
- 该窗口由 `tests/manifest-compat.spec.ts` 守护；改动必须同时更新测试与本文档。

## 4. 更新前（建议 30 秒）

```powershell
# 1) 记录当前宿主与插件版本（通过内置 CLI，不用全局 dsh）
& 'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' --version

# 2) 只读兼容探针：预测这次更新后插件是否会被跳过（Electron 运行时）
$env:ELECTRON_RUN_AS_NODE='1'
& 'C:\DeepSeek Harness\DeepSeek Harness.exe' scripts\verification\host-compat-check.mjs desktop

# 3) 先关掉 DSH，再做一条命令的稳定快照（自带校验与 manifest）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verification\manual\backup-memory.ps1
```

- `host-compat-check.mjs` 只读，不启动 DSH、不改 profile；输出 `docs/evidence/S05-v020-compat/host-compat.json`。
- 若 `host-version-in-declared-window` 为 `false`，先不要更新 DSH，或先安装覆盖新窗口的插件候选。
- `backup-memory.ps1` 默认备份 `~/.dsh/memory-wh` 到 `~/.dsh/backups/memory-wh-<时间>/`，备份后立即用 `verify` 复核，并在同目录写 `backup-manifest.json`（含快照 SHA-256）。DSH 未关闭时脚本会拒绝执行（`-AllowRunningDsh` 可显式接受风险）。快照是明文 JSON，要防丢还需复制到另一块磁盘。

## 5. 更新后（插件入口不在时）

按顺序做，**每一步都不删除 `memory-wh`**：

1. **看日志**：启动日志里找 `skipping profile bundle "dsh-auto-memory-wh"` 与 `incompatible with dsh <版本>`。确认是兼容性跳过，而不是依赖安装失败。
2. **核实现场**：

   ```powershell
   Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
   Test-Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-auto-memory-wh\package.json"
   Test-Path "$env:USERPROFILE\.dsh\memory-wh\_user\MEMORY.md"
   ```

   三者都在，说明数据与安装未受损。
3. **恢复入口**（按优先级）：
   - **a. 安装覆盖当前宿主的新候选**（推荐）：`dsh plugin --profile desktop add <新 tgz> --ignore-scripts`，关闭并重开 DSH。
   - **b. 精确版本豁免**（仅在确认“只是版本范围窄、API 未变”时）：在插件的“版本豁免”入口（插件管理器）为该精确 `dsh-auto-memory-wh@版本` 添加当前运行时版本；或在宿主明确提供 `dsh plugin allow-version` 的版本上使用该命令。豁免是显式风险接受，升级插件后应移除。
   - **c. 重装同一版本**：`remove` 后 `add` 同一 tgz；用于依赖目录损坏（如半写入）而不是版本不兼容。
4. **验证**：重开后确认侧栏“记忆 WH”出现；`memory_list` 记录数与升级前一致；`memory-wh\_user\MEMORY.md` 存在；审计继续追加。

## 6. 数据安全边界

- 兼容检查发生在**装载插件之前**，被跳过时插件没有任何写入机会。
- `memory-wh` 不在 profile 的依赖树里；`remove`/`add`/升级都不会删除它。
- 恢复动作（安装、豁免）不会迁移或重写既有记忆；旧记录的信任状态与 revision 保持不变。
- 唯一需要额外小心的是：手动删除 `memory-wh` 或覆盖 `MEMORY.md`——这不在任何自动流程内。

## 7. 已知限制

- `engines.dsh` 只能表达“我愿意尝试加载”，不能证明宿主 API 行为完全一致；宽窗口意味着把未知风险留给运行时。因此每次 DSH 大版本更新后仍建议跑一次验收探针与面板冒烟。
- 版本豁免是精确匹配，不会随宿主升级自动扩展；忘记移除会掩盖后续不兼容。
- 本 runbook 不覆盖“宿主自身启动失败”或“profile 依赖整体损坏”，那属于 DSH 安装问题。

## 8. 与 0.1.0 事件的关系

0.1.0 发布候选声明的是 `>=0.2.1-rc.5 <0.3.0`；DSH 自动升级到 `0.2.2-rc.1` 时该版本本身在窗口内，但早期的 peer 列表不含 `0.2.2-rc.1`，加上宿主优先按 peer 判定，导致整包被跳过。修复（r117）改为以 `engines.dsh` 为准；r119 把窗口放宽到 `<1.0.0` 并加入探针与本文档。
