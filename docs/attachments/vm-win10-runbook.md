# VirtualBox Win10 VM 第二宿主验收 runbook（rc.17）

> 用途：在**第二套 DSH** 与第二台 Windows 上验证 WH `1.0.0-rc.17` 的安装、面板、升级/回退与数据行为；不影响日常桌面。
> 宿主基线：主机 DSH `0.2.2-rc.3` 已在隔离 profile 上跑过 22/22；VM 里用 **DSH 0.2.1-rc.5**（插件声明的最低支持版本）做兼容性验证。
> 证据统一放共享文件夹 `C:\dsh-vm-share\evidence\`（客户机内 `Z:\evidence\`）。

## 0. 一次性准备

1. 打快照 `clean-win10`（已有 `before-dsh-install` 也可，任选其一，别污染断电演练基线）。
2. VM 设置：4 GB 内存、2 CPU；显示 128 MB；共享文件夹添加 `C:\dsh-vm-share` → 名称 `dshshare`，勾“自动挂载”“固定分配”。
3. 安装 Guest Additions 并重启；客户机 `Get-PSDrive -PSProvider FileSystem` 应能看到共享盘（通常是 `Z:`）。
4. 确认共享文件存在：

   ```powershell
   Test-Path 'Z:\dsh-auto-memory-wh-1.0.0-rc.17.tgz'
   ```

5. 时间同步：`w32tm /resync`，并确认 `Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'` 与主机一致（时区 `China Standard Time`）。

## 1. 安装/确认 DSH

如果 VM 里已经装过 portable DSH（之前从 `Z:\portable-dsh` 复制到 `C:\portable-dsh`），直接确认版本：

```powershell
$dsh = 'C:\portable-dsh\resources\runtime\cli\bin\dsh.cmd'
& $dsh --version          # 期望 0.2.1-rc.5
```

如果没装：

```powershell
robocopy Z:\portable-dsh C:\portable-dsh /E
$dsh = 'C:\portable-dsh\resources\runtime\cli\bin\dsh.cmd'
```

然后**先打开一次 DSH 桌面端**（初始化 desktop profile），看到主界面后完全退出。

> 如果客户机装的是安装版 DSH，CLI 在 `C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`；用 `Get-ChildItem C:\ -Filter dsh.cmd -Recurse` 找真实路径。

## 2. 安装 WH rc.17

```powershell
& $dsh plugin --profile desktop add 'Z:\dsh-auto-memory-wh-1.0.0-rc.17.tgz' --ignore-scripts
```

核对（通过标准）：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-auto-memory-wh\package.json" -Raw |
  ConvertFrom-Json | Select-Object -ExpandProperty version
(Get-FileHash "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-auto-memory-wh\lib\index.js" -Algorithm SHA256).Hash
(Get-FileHash 'Z:\dsh-auto-memory-wh-1.0.0-rc.17.tgz' -Algorithm SHA256).Hash
```

| 项 | 期望值 |
| --- | --- |
| version | `1.0.0-rc.17` |
| `lib/index.js` SHA-256 | `3402A81CB8538A78CBDFB62441E3D90EF4A988A98B6707E3EAE94DACF9A4A556` |
| tgz SHA-256 | `EEDF90AC237567DF47F4E37D0D57BB68A2E8179A00BE45F1E43869BA74AEB6EC` |

`[WARN] Issues with peer dependencies` 可忽略（宿主包由 DSH 自带）。

## 3. 面板 smoke（打开“记忆 WH”）

逐项打勾并截图：

- [ ] 面板能打开，范围可选“用户记忆 / 项目”。
- [ ] “人物弧光”能渲染，按主题成章。
- [ ] **导出 JSON 包**：设置菜单 →“导出 JSON 包”，应下载 `wh-user-package.json`，不再报“宿主返回了无法识别的响应”。
- [ ] **导入预演**：设置菜单 →“导入 JSON 包”选刚导出的文件，出现校验和与新增/更新/相同/冲突计数；“应用导入”前不写数据。
- [ ] **拖拽**：拖 `.json` 到面板出现虚线遮罩；松手显示“文件大小 · N 条记录”。
- [ ] **无效包**：拖一个内容为 `111` 的 `.json`，提示“不是 WH 记忆包/没有 records 列表”，且无预览、不写数据。
- [ ] **归档**：新建一条测试记忆 →“移至归档”→ 该行内出现“确认归档 / 取消”，点“确认归档”后消失。
- [ ] **编辑器**：点“查看 / 编辑”，按钮变“查看 / 编辑：取消”，点它收起；点卡片空白处**不应**收起。
- [ ] **合并无二次确认**：“重复与合并”点“合并这一组”应直接执行，无弹窗；结果显示“已合并 / 已跳过”。
- [ ] 收起/展开“重复与合并”后，结果提示仍在。

## 4. 升级 / 回退演练（数据不变）

记录升级前摘要：

```powershell
$mem = "$env:USERPROFILE\.dsh\memory-wh"
if (Test-Path $mem) {
  Get-ChildItem $mem -Recurse -File |
    ForEach-Object { "$($_.FullName)|$((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" } |
    Sort-Object | Set-Content Z:\evidence\memory-before.txt
} else {
  'memory-wh absent' | Set-Content Z:\evidence\memory-before.txt
}
```

装 rc.16 → 再装回 rc.17，然后重算摘要：

```powershell
& $dsh plugin --profile desktop add 'Z:\dsh-auto-memory-wh-1.0.0-rc.16.tgz' --ignore-scripts
& $dsh plugin --profile desktop add 'Z:\dsh-auto-memory-wh-1.0.0-rc.17.tgz' --ignore-scripts

if (Test-Path $mem) {
  Get-ChildItem $mem -Recurse -File |
    ForEach-Object { "$($_.FullName)|$((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" } |
    Sort-Object | Set-Content Z:\evidence\memory-after.txt
} else {
  'memory-wh absent' | Set-Content Z:\evidence\memory-after.txt
}
Compare-Object (Get-Content Z:\evidence\memory-before.txt) (Get-Content Z:\evidence\memory-after.txt)
```

通过标准：`Compare-Object` **无输出**；最后版本/哈希按第 2 节复核。

> 若 VM 是空 profile（没有记忆），摘要两边都是 `memory-wh absent`，属弱验证；强验证以主机桌面 31 条真实记忆的 7/7 为准，VM 只证明“升级回退不破坏存储”。

## 5. 提醒补投（可选，需要登录模型）

1. 让模型“2 分钟后提醒我测试补投”，记下 id 与时间。
2. 完全退出 DSH，等待超过到期时间但在 30 分钟内，重开。
3. 应补投到原会话；截图并记时间线。
4. 超宽限场景（约 40 分钟）时间不够就跳过，标“未覆盖”。

## 6. 证据清单（`Z:\evidence\`）

| 文件 | 内容 |
| --- | --- |
| `versions.txt` | DSH 版本、WH 版本、lib 哈希、tgz 哈希、Windows 版本 |
| `panel-smoke.png` | 导出、导入预演、拖拽、归档、编辑器、合并结果（可多张） |
| `memory-before.txt` / `memory-after.txt` | 升级回退前后摘要 |
| `compare.txt` | `Compare-Object` 输出（应为空） |
| `reminder.txt` | 补投时间线（若做） |

## 7. 失败处理

任一项失败：**保留客户机现场**，不要重装掩盖。导出：

- DSH 版本与 CLI 路径；
- `~/.dsh/profiles/desktop/node_modules/dsh-auto-memory-wh/package.json`；
- 失败步骤截图 + DSH 日志（`~/.dsh/logs` 或终端输出）；
- 复现时间。

把证据发回，先判断插件问题还是宿主差异，再决定发布。

## 8. 发布门槛

- 第 2、3、4 节全过 → 可发 `npm publish --tag next` + GitHub pre-release；
- 第 5、6 节未做 → 发布说明写“第二宿主为 VirtualBox Win10；补投/双机 relay 未在 VM 验证”；
- 安装、数据完整性或其他阻塞项失败 → 暂停发布并排查，保留 rc.16 回退包；不能以 next 标签代替修复。
