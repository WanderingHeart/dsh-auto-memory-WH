# WH 同步协议与端侧适配契约（v1）

本文件是给“同步载体”（U 盘、网盘、浏览器扩展、移动端、宿主自带同步服务）的最小契约。载体只搬运两类 JSON 和不透明字节，不直接读写记忆正文。

## 1. 角色与边界

- **端点（endpoint）**：一台设备上的 WH 实例，持有 `root`、`scope`、设备身份、信任列表与一个游标文件。
- **载体（carrier）**：把信封从 A 送到 B 的任何东西（手动复制、网盘、对象存储、扩展消息通道）。载体不需要理解内容，也不应该修改字节。
- **传输层（transport）**：载体的一种自动化实现。v0.4.0 起内置 `wh-sync-relay` HTTP 中继（`src/transport.ts` 客户端 + `src/sync-relay.ts` 参考服务端），只做鉴权、排队、幂等去重与确认，不解析、不记录明文。
- **安全边界**：信封保证“发送方可信、内容未被篡改、只有收件人能解密”，不隐藏文件名/大小/时间，也不提供传输层认证或撤销。

## 2. 端点接口

`src/endpoint.ts`：

```ts
interface SyncEndpoint {
  readonly deviceId: string
  readonly scope: 'user' | 'project'
  changes(since?: number): Promise<Changeset>
  seal(changeset: Changeset, recipient: string): SyncEnvelope
  apply(envelope: SyncEnvelope, options?: { onConflict?: 'manual' | 'remote' | 'fork' }): Promise<ApplyResult>
  state(): Promise<SyncState | null>
  recordSent(until: number): Promise<void>
}
```

约定：

1. `changes()` 不传 `since` 时使用本地持久化的接收游标；首次为 0。推送流程显式使用发送游标 `sentCursor`（见 §4）。
2. `seal()` 只允许信任列表内的收件人；信封绑定收件人 `deviceId`。
3. `apply()` 依次校验信封、变更集、冲突策略；成功后把游标推进到变更集 `until`。
4. 端点不提供“合并/改写”能力；冲突处理仍是 r132 的语义。
5. 载体可以重放：同一信封重复 `apply` 结果幂等（相同内容记为 skipped）。
6. `recordSent()` 在传输层接受（或去重命中）信封后记录“已发出的最高 `until`”；它与接收游标互相独立，`apply()` 不会覆盖它。游标是排他的：`since = until` 只会产出更新的变更。

## 3. 信封与变更集

### 3.1 信封

```json
{
  "format": "wh-sync-envelope",
  "version": 1,
  "sender": { "deviceId": "dev-…", "signPublicKey": "…", "encPublicKey": "…" },
  "recipient": { "deviceId": "dev-…" },
  "nonce": "…",
  "ciphertext": "…",
  "signature": "…"
}
```

- 签名覆盖“去掉 `signature` 的信封规范化 JSON”。
- `ciphertext` = AES-256-GCM(变更集 JSON) + 16 字节认证标签。
- 密钥 = X25519 ECDH → HKDF-SHA256(info `wh-sync-v1`) → 32 字节。

### 3.2 变更集

`wh-sync-changeset` v1，字段与校验见 `docs/storage-recovery.md` 与 r132 报告；`until` 是游标推进值，`checksum` 覆盖游标与全部 upsert/deletion。

### 3.3 任务字段（v0.5.0 加法扩展）

`type: 'task'` 的记录可以额外带四个可选字段，随变更集与导出包一起传输：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `dueAt` | 正的 epoch ms 整数 | 任务截止时间 |
| `remindAt` | 正的 epoch ms 整数 | 提醒时点；缺省时用 `dueAt` |
| `priority` | 1–5 的整数 | 1 最高，缺省 3 |
| `taskStatus` | `open` / `done` / `cancelled` | 执行状态，与审核 `status` 正交 |

兼容规则：

1. 这是加法扩展：旧端点可以忽略未知字段；缺失表示“本地不改变该字段”，而不是清空。
2. 字段参与记录序列化与 `checksum`；`sameContent` 也比对它们，所以“只改截止时间”会正常传播，不会被当成无变化跳过。
3. 非 `task` 记录携带任一任务字段会被拒绝（`INVALID_CHANGESET` / `INVALID_RECORD`，提示“任务字段要求 type=task”）；时间字段非正安全整数、`priority` 越界、`taskStatus` 未知值同样拒绝。
4. 任务字段不参与 `reviewFingerprint`：改期不会把已审核记录降级为 candidate。
5. 同步不负责投递提醒；提醒由各端本地按 `remindAt ?? dueAt` 与审核状态决定。

### 3.4 主题字段（v1.0.0-rc.6 加法扩展）

记录可带可选的 `topic`（字符串，主题注册表 id，格式 `[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}`）。它随变更集与导出包一起传输；旧端点忽略该字段时只失去章节归属，正文仍然可用。`topic` 参与 `checksum`，但不参与 `sameContent`——只改主题不会把已审核记录降级。

### 3.5 冲突策略（v1.0.0-rc.6）

本地已审核记录与远端内容不同时：

| `onConflict` | 行为 |
| --- | --- |
| `manual`（默认，导入为 `reject`） | 不写本地，记入 `conflicts`，由人处理 |
| `remote` | 远端覆盖本地，写入后状态回到 `candidate`（需重新审核） |
| `fork` | 本地不动；远端内容另存为 `<原 name 前 48 字>-shared-<内容指纹 6 位>` 的 `candidate`，记入 `forked` |

`fork` 的副本名由内容确定，重复应用同一变更集只会得到 `skipped`，不会无限增殖；副本可由所有者在面板里审核、合并或删除。

## 4. 生命周期

```
A: changes() → changeset
A: seal(changeset, B) → envelope
载体 → B
B: apply(envelope) → created/updated/conflicts，cursor := until
B: changes() → 回传
A: apply(...)
```

双向同步不需要额外协商；每端各自维护自己的游标与信任列表。

自动化载体（`src/sync-flow.ts`）把上面的手工步骤串起来：

```
A: pushToPeer(endpoint, transport, B)   // since = sentCursor（首次 0）
   changes() → seal() → POST /v1/messages → recordSent(until)
B: pullFromPeer(endpoint, transport)    // 最多 limit 条，按到达顺序
   GET /v1/messages → apply() → 仅对成功的消息 POST /v1/ack
```

`pushToPeer` 在没有新变更时不发请求；`pullFromPeer` 对失败消息不确认，因此毒信封会留在队列里等待人工处理。

## 5. 传输层：`wh-sync-relay` v1

参考实现：客户端 `src/transport.ts`，服务端 `src/sync-relay.ts`；CLI `sync-push` / `sync-pull` / `sync-relay`。

### 5.1 端点

| 方法与路径 | 作用 | 请求/响应 |
| --- | --- | --- |
| `POST /v1/messages` | 投递一个信封 | `{"envelope":{…}}` → `{"id":"msg-…","duplicate":false}` |
| `GET /v1/messages?recipient=…&limit=…` | 按到达顺序拉取收件人队列 | → `{"messages":[{id,recipient,sender,receivedAt,envelope}]}` |
| `POST /v1/ack` | 确认已应用的消息 | `{"recipient":"dev-…","ids":["msg-…"]}` → `{"acked":1}` |
| `GET /v1/health` | 队列与保留期概览 | → `{"ok":true,"queued":0,"retentionMs":604800000}` |

### 5.2 鉴权与投递语义

- 单一共享 bearer token（≥16 字符，常量时间比较）；中继默认只绑定 `127.0.0.1`。token 是信任边界，不是每设备授权。
- 消息 id = `msg-` + `sha256(canonicalJson(envelope))` 前 32 hex。同一信封重发只会命中同一条消息（`duplicate: true`），因此“至少一次投递 + 客户端重试”不会产生重复队列项。
- 队列按收件人隔离，落盘为 `<root>/queue/<recipient>/<msg-id>.json`（临时文件 + rename 原子写入）；默认保留 7 天、每收件人上限 500 条、请求体上限 16 MiB、信封上限 12 MiB。
- 接收方 `apply` 成功后才 ack；失败或无法解密的消息保留，重复拉取会再次尝试。队列满时返回 429，客户端抛 `TRANSPORT_BACKPRESSURE`。
- 中继不解密、不记录信封内容，只保存密文与路由元数据（发送方/收件人/到达时间）。

### 5.3 客户端错误映射

| HTTP | `TransportError.code` | 处理 |
| --- | --- | --- |
| 401 / 403 | `TRANSPORT_UNAUTHORIZED` | 检查 token；不要重试到成功 |
| 429 | `TRANSPORT_BACKPRESSURE` | 先 `sync-pull` 消费队列，再重试 |
| 5xx / 连接失败 | `TRANSPORT_UNAVAILABLE` | 退避重试；中继未启动 |
| 请求超时 | `TRANSPORT_TIMEOUT` | 可安全重试（幂等） |
| 其他 4xx | `TRANSPORT_REJECTED` | 结构/大小问题，停止并检查 |
| 非 JSON 响应 | `TRANSPORT_BAD_RESPONSE` | 停止，检查中间代理 |

### 5.4 明确不做

不提供 TLS 终止（反向代理负责）、每设备授权/撤销、设备发现与配对、密钥轮换、托管服务、对象存储/WebSocket 载体、移动端后台常驻。中继是“自己的设备之间”的自托管组件。

## 6. 错误码

| 代码 | 含义 | 载体应对 |
| --- | --- | --- |
| `UNSUPPORTED_FORMAT` / `UNSUPPORTED_VERSION` | 不是 WH v1 信封 | 停止，提示升级 |
| `WRONG_RECIPIENT` | 收件人不是本设备 | 转发给正确设备，勿重试 |
| `UNTRUSTED_SENDER` | 发送方不在信任列表 | 要求先交换公钥并加入信任 |
| `KEY_MISMATCH` | 公钥与信任记录不一致 | 停止并人工核对（可能被替换） |
| `BAD_SIGNATURE` / `DECRYPT_FAILED` | 内容或密钥损坏/被改 | 丢弃并重新导出 |
| `CHECKSUM_MISMATCH` | 变更集被改或版本不匹配 | 丢弃并重新导出 |
| `INVALID_CHANGESET` | 结构非法 | 停止，保留现场 |

## 7. 适配清单

一个合格载体至少要：

1. 原样传输信封字节，不做 JSON 重排/转码；
2. 知道“谁发给谁”，但不需要知道内容；
3. 允许重放（至少一次投递），不要求恰好一次；
4. 不在传输层丢弃大文件（单信封上限 8 MiB + base64 膨胀）；
5. 失败可重试；端点是幂等的。
6. 若自带中继：按 §5 配置 bearer token 与队列目录，token 不写入仓库、不进日志。

不适合直接做载体的：会改写 JSON 的格式化工具、对内容做“智能摘要”的转发、要求端到端之外再做一次压缩/加密并丢字段的管道。

## 8. 已知未实现

- 在线配对、二维码、设备发现；
- 密钥轮换、撤销列表、前向保密；
- 传输层的 TLS 终止、每设备授权/撤销、对象存储与 WebSocket 载体（v0.4.0 只有共享 token 的 HTTP 中继）；
- 浏览器扩展/移动端真实载体（本仓库只提供协议与本地桩）；
- 大文件分片：单信封上限 8 MiB，超出应拆分为多个变更集（按 `since`/`until` 分段）。
- 毒消息的自动隔离/告警：无法解密或校验失败的信封会一直留在队列中，需要人工 `sync-pull` 观察并清理队列目录。

## 9. 验证

- 契约测试：`tests/endpoint.spec.ts`（5 项：导出/封装/应用、游标、幂等重放、未信任/错收件人、冲突与 remote-wins）、`tests/sync.spec.ts`（8 项：导出/应用、幂等、游标更新、删除归档、remote-wins、篡改、topic、fork）、`tests/transfer.spec.ts`（7 项：包往返、校验和、坏记录、冲突、fork、topic、坏 topic）。
- 传输层：`tests/transport.spec.ts`（12 项：中继往返、鉴权失败、幂等投递、队列背压、超大信封、保留期、ack 未知 id、收件人隔离、重启持久化、发送游标不重发、毒消息留队、错误类型）。
- 演练：`scripts/verification/sync-envelope-drill.mjs`（9/9，证据 `docs/evidence/S05-v040-sync/envelope-drill.json`）、`scripts/verification/sync-http-drill.mjs`（14/14，证据 `docs/evidence/S05-v040-transport/http-relay.json`）。
- 加密与信任：`tests/device-identity.spec.ts`（7 项）、`scripts/verification/sync-secure-drill.mjs`（8/8）。
