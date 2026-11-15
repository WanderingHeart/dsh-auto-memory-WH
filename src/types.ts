/**
 * dsh-auto-memory 核心类型定义。
 * 对齐 Claude Code auto-memory 的记忆模型:单文件 + frontmatter + 四种类型。
 * (插件配置 Config 定义在 index.ts,官方惯例。)
 */

/** 记忆类型(对齐 Claude Code 的四种语义;v0.5.0 增加任务型记忆)。 */
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'task'

/**
 * 任务生命周期(与审核状态 status 正交):
 * open 未完成、done 已完成、cancelled 已取消。缺省视为 open。
 */
export type TaskStatus = 'open' | 'done' | 'cancelled'

/** 作用域:项目级(workspace 隔离)或用户级(所有会话共享)。 */
export type MemoryScope = 'project' | 'user'

/**
 * S04 信任状态：缺省为 legacy 未审核，新建为 candidate。
 * 仅内容指纹匹配的 verified 可自动注入；审核由受认证管理接口显式授予。
 * 指纹不是签名，不能抵御同权限进程恶意重写。
 */
export type MemoryStatus = 'candidate' | 'verified' | 'disputed' | 'superseded'

/** 可信状态的证据链:这条记忆"从哪来、凭什么信"。 */
export interface MemoryEvidence {
  /** 产生这条记忆的会话(固化的源会话;面板点击可定位)。 */
  sessionId: string
  /** 支撑该事实的转写逐字摘录(1-2 句;LLM 提供并经清洗,非逐字保证时诚实降级)。 */
  quote: string
}

/**
 * 记忆来源(导入溯源):记录"这条记忆是从哪里导进来的"。
 * 撤销导入时据此判断来源是否匹配;`hash` 是导入时的内容指纹,任何写入路径
 * 都继承原值、绝不重算——指纹与当前内容不一致即"导入后被改过",撤销时保留。
 */
export interface MemoryOrigin {
  /** 来源种类(目前只有 Claude Code 导入桥)。 */
  kind: 'claude-code'
  /** 源项目目录名(Claude 侧 `~/.claude/projects/<slug>`)。 */
  slug: string
  /** 源记忆文件名(含 .md)。 */
  file: string
  /** 首次导入时间(epoch ms)。 */
  importedMs: number
  /** 导入时的内容指纹(sha256 前 16 位);由 store 在清洗后计算。 */
  hash: string
}

/** 一条持久记忆。与磁盘上单个 .md 文件一一对应。 */
export interface MemoryRecord {
  /** Reviewed semantic content hash; absent/stale hashes never grant verification. */
  reviewHash?: string
  trustReason?: string
  /** SHA-256 of the exact source bytes; never serialized into frontmatter. */
  revision?: string
  /** Unknown frontmatter fields retained across ordinary edits. */
  metadata?: Record<string, unknown>
  /** kebab-case 标识,同时是文件名(不含扩展名)。 */
  name: string
  /** 人类可读标题(可含中文,进索引行链接文本);缺省用 name。 */
  title?: string
  /** 一行摘要:注入索引展示、召回相关性判断、查重依据。 */
  description: string
  /** 四种类型之一。 */
  type: MemoryType
  /** 正文事实。feedback 类型约定包含 **Why:** 与 **How to apply:** 行。 */
  body: string
  /** 来源作用域(决定存储目录)。 */
  scope: MemoryScope
  /** 置顶保护(P2-3):软淘汰永不隐藏;索引渲染排在最前,预算截断天然优先保留。 */
  pinned?: boolean
  /** 软停用(#10):不注入、不删除——删除与保留之间的第三档;memory_list 可见。 */
  disabled?: boolean
  /** 重要度 1-10(三因子排序用;固化时 LLM 显式打分,缺省按类型映射)。 */
  importance?: number
  /** 可信状态：仅 verified 且内容指纹匹配时自动注入。 */
  status?: MemoryStatus
  /** 证据链(固化时生成;候选验证状态的用户依据)。 */
  evidence?: MemoryEvidence
  /** #19 演化谱系:本条(旧)被哪条记忆取代(值=新记忆 name;仅 status='superseded' 有意义)。 */
  supersededBy?: string
  /** #19 演化谱系:本条(新)取代了哪条旧记忆(值=旧记忆 name;固化矛盾检测写入)。 */
  supersedes?: string
  /**
   * v1.0.0-rc.2 主题大类(每个 scope 一份注册表;值来自 topics.json 的 id)。
   * 语义由模型在写入/总结时从注册表中选择或提议,不是词法标签;
   * 缺省表示尚未归类(仅迁移未完成的旧数据),不参与自动合并。
   */
  topic?: string

  /** 导入溯源(缺省 = 非导入记忆);仅导入桥写入,撤销导入据此判定。 */
  origin?: MemoryOrigin
  /** 生命周期元数据(P1 遗忘策略用;旧文件缺省时由解析层补全)。 */
  createdMs?: number
  updatedMs?: number
  lastReadMs?: number
  reads?: number
  /** 任务截止时间(epoch ms;仅 type='task' 有意义)。 */
  dueAt?: number
  /**
   * 提醒时点(epoch ms;仅 type='task')。缺省时以 dueAt 作为提醒时点;
   * 可以早于 dueAt(提前提醒),也可以晚于(逾期后才提醒)。
   */
  remindAt?: number
  /** 任务优先级 1(最高)-5(最低);缺省 3。 */
  priority?: number
  /** 任务生命周期;缺省 open。与审核状态 status 相互独立。 */
  taskStatus?: TaskStatus
  /**
   * 提醒投递目标会话(仅 type='task')。缺省时宿主桥接用 `new_once` 新开会话;
   * 有值时改为投递到该会话(通常就是创建任务的那个会话,符合“在哪说的就在哪提醒”)。
   * 会话归档/不存在时桥接自动降级回 `new_once`,并把该字段清掉。
   */
  notifySessionId?: string
}

/** 用户级作用域的目录名(下划线前缀避免与项目 slug `--...--` 冲突)。 */
export const USER_SCOPE_DIR = '_user'
