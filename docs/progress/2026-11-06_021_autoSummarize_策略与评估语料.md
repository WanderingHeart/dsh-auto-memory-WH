> 公开脱敏版：保留当时的版本、结果与限制；本机路径已泛化，原始日志/截图和私人操作记录不公开。历史描述不代表当前版本。

# S05 v0.2.0 autoSummarize 策略与评估语料（r118）

- 日期：2026-11-06
- 阶段：S05 → v0.2.0 开发线（本地候选，未发布）
- 状态：第一项完成；源码/测试/文档已改，0.1.0 冻结候选未动

## 起因

v0.1.0 的 `autoSummarize` 已经能用：会话结束时调用当前模型，把候选写入 `candidate`，再由所有者审核。但默认关闭，而且没有“少调用模型、少写噪声、可回归”的策略：

- 短会话/纯闲聊也会触发一次模型调用；
- 同一事实反复出现会重复落盘，审核队列被稀释；
- 没有任何合成语料能证明“门槛、去重、取代、价值过滤”这些语义没有回归。

本阶段只做策略与评估，不改动信任模型、存储格式或 UI。

## 实现

### 1. 门槛（不达标不调用模型）

`src/consolidate.ts` 新增 `shouldConsolidate(lines, { minTurns, minChars })`：

- 只统计 `USER: ` 行（助手输出不计入轮数）；
- `userTurns < minTurns` 或 `chars < minChars` 时返回 `ok: false`，`agent/disposed` 直接 return，**不发起 LLM 调用**；
- 两个门槛都设为 `0` 视为关闭。

### 2. 新建前去重

`findDuplicateCandidate(candidate, existingList)`：同 `type` + 同 `scope`，正文或描述经过归一化（小写、压缩空白、去常见中英标点，含 `.`）后相同，即视为重复。去重只作用于**新建分支**；更新与矛盾取代路径保持原语义。

### 3. 统一应用入口

`applyConsolidationCandidates(...)` 取代原先的内联循环，返回：

```ts
{ written, created, updated, superseded, duplicate, chitchat, lowImportance, invalid }
```

保留：`minImportance` 价值门槛、闲聊过滤、`status` 强制为 `candidate`、`evidence` 伪造过滤、user scope 降级、`autoSummarizeMaxMemories` 上限。日志按 tally 输出，便于事后审计。

### 4. 配置

| 键 | 默认 | 约束 |
| --- | --- | --- |
| `autoSummarizeMinTurns` | 2 | 0–40 安全整数；0 关闭 |
| `autoSummarizeMinChars` | 600 | 0–24000 安全整数；0 关闭 |
| `autoSummarizeDedupe` | true | 布尔 |

`normalizeConfig` 对越界值抛出 `Invalid autoSummarizeMinTurns` / `Invalid autoSummarizeMinChars`；`docs/configuration.md` 已同步表格与说明。

## 评估语料

`tests/fixtures/autosummarize/corpus.json` 共 13 个合成会话用例，全部使用真实 `MemoryStore`（临时目录）：

1. 创建新偏好（正常写入 candidate）
2. 纯闲聊（不写）
3. 低重要度（不写）
4. 同名更新（走更新分支）
5. 日期矛盾（取代链）
6. 同体异名（去重）
7. 大小写/标点差异（去重）
8. 关闭去重后创建（允许）
9. 不同 type（不去重）
10. 非法候选（计入 invalid）
11. user scope 降级（项目候选不能自升为 user）
12. 伪造 evidence（丢弃）
13. `maxMemories` 上限（截断）

用例断言的是**决策与最终存储状态**，不是模型输出质量。

## 验证

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（exit 0） |
| `npm test` | **27 文件 / 307 用例全部通过**（10.50s；原 281 + 新增 26） |
| 评估入口 `node scripts/verification/autosummarize-eval.mjs` | **PASS 14/14**（13 语料 + 1 元数据），证据 `docs/evidence/S05-v020-autosummarize/eval.json`，at `2026-11-06T14:01:43.106Z` |
| 全量回归 | 27 文件 307/307（11 项策略单测 + 14 项语料 + 1 项配置边界） |

## 边界与未做

- **未构建 `lib/`**：0.1.0 候选包（`356C0DB6…3193` / `lib/index.js 2CE1DEEF…C11E`）保持冻结，避免开发代码污染已验收产物。构建、版本号提升与 v0.2.0 候选打包留到切版本时。
- **未调用真实模型**：评估语料直接提供“模型候选批”，验证的是插件侧决策；真实模型的提取质量不在本项范围。
- **门槛默认仍为关闭**：`autoSummarize=false` 不变；本项只提供开启后的策略与回归证据。
- 页面上的“批量审核/合并”和自动备份不在本项；对应 roadmap 5.1 的第 2–5 项。

## 下一步

1. 候选集中审核（批量通过/忽略、来源会话展示）；
2. 搜索与去重（近重复、项目/类型/时间过滤）；
3. 备份自动化；
4. 迁移引导（旧 `memory` → `memory-wh` 向导）。

按 roadmap 5.1 的退出条件，五项都有可复跑验收后再切 v0.2.0 候选；届时统一更新版本号、CHANGELOG、验收清单与 21 步入口。
