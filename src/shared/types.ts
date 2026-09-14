/**
 * 主进程 / 预加载 / 渲染进程共享的类型定义。
 * 该文件必须保持零依赖，可被任意进程安全引入。
 */

/** 归一化后的消息类型 */
export type MessageKind =
  | 'text'
  | 'image'
  | 'file'
  | 'at'
  | 'quote'
  | 'emoji'
  | 'system'
  | 'withdrawn'
  | 'unknown'

/** 消息来源应用标识 */
export const SOURCE_APP_NAME = '猿通讯'

/** 会话类型 */
export type ChatKind = 'single' | 'group' | 'unknown'

/** 会话列表项 */
export interface ChatItem {
  id: string
  name: string
  avatar: string
  kind: ChatKind
  chatType: string
  isTop: boolean
  messageCount: number
  lastTimestamp: number
  lastPreview: string
  seq: number
}

/** 当前会话概览 */
export interface ChatMeta {
  chatId: string
  name: string
  kind: ChatKind
  messageCount: number
  memberCount: number
  firstDate: string
  lastDate: string
}

/** 发送人分面 */
export interface SenderFacet {
  fromId: string
  name: string
  count: number
}

/** 消息类型分面 */
export interface KindFacet {
  kind: MessageKind
  count: number
}

/** 单条消息 */
export interface MessageItem {
  id: string
  rowId: number
  chatId: string
  chatType: string
  fromId: string
  name: string
  avatar: string
  kind: MessageKind
  messageType: string
  isMine: boolean
  isWithdrawn: boolean
  at: string
  timestamp: number
  strDate: string
  /** 已解码并抽取的纯文本，用于展示、检索与高亮 */
  text: string
  /** 已解码的原始内容，供渲染层做结构化解析 */
  raw: string
}

/** 多维查询条件 */
export interface MessageQuery {
  chatId?: string
  keyword?: string
  fromIds?: string[]
  kinds?: MessageKind[]
  dateFrom?: string
  dateTo?: string
  cursor?: string | null
  direction?: 'older' | 'newer'
  limit?: number
}

/** 会话列表查询条件 */
export interface ChatQuery {
  keyword?: string
  scope?: 'all' | 'single' | 'group' | 'top'
}

/** 分页结果 */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
  total?: number
}

/** 全局搜索结果分组（按会话聚合） */
export interface SearchGroup {
  chatId: string
  chatName: string
  chatKind: ChatKind
  count: number
  items: MessageItem[]
}

/** 全局搜索结果 */
export interface SearchResponse {
  total: number
  tookMs: number
  groups: SearchGroup[]
  nextCursor: string | null
  hasMore: boolean
}

/** 筛选面板可选分面数据 */
export interface FacetResponse {
  senders: SenderFacet[]
  kinds: KindFacet[]
  dateRange: { from: string; to: string }
}

/** 发现到的数据源文件 */
export interface DbSource {
  path: string
  fileName: string
  sizeBytes: number
  modifiedAt: number
  valid: boolean
  tableCount: number
  error?: string
  /** 来源：用户配置 / 内置默认目录 */
  origin: 'configured' | 'default'
  /** 是否位于猿通讯默认数据目录（%APPDATA%\boctx）下 */
  inBoctx: boolean
  /** 该库内消息条数（不可用时为 0） */
  messageCount: number
  /** 该库内最新一条消息的时间戳，用于判断数据新旧（0 表示未知） */
  newestTimestamp: number
}

/** 数据源选择范围：单个文件，或某目录下的全部数据库（合并查看） */
export type SelectionKind = 'file' | 'dir'

export interface SourceSelection {
  kind: SelectionKind
  path: string
}

/** 用户可持久化的配置 */
export interface AppConfig {
  /** 用户添加的扫描目录（递归扫描） */
  dataDirs: string[]
  /** 用户添加的单个数据库文件 */
  dataFiles: string[]
  /** 上次使用的数据源范围，下次启动优先恢复 */
  lastSelection: SourceSelection | null
}

/** 索引缓存状态 */
export interface IndexStatus {
  phase: 'idle' | 'building' | 'ready' | 'error'
  /** 当前选择范围类型 */
  selectionKind: SelectionKind | null
  /** 当前选择范围路径（文件或目录） */
  selectionPath: string | null
  /** 实际参与合并的数据库文件（已按优先级排序） */
  includedFiles: string[]
  /** 合并时因消息 ID 重复而被跳过的条数 */
  duplicateMessages: number
  /** 展示用名称 */
  sourceName: string | null
  cachePath: string | null
  cacheSizeBytes: number
  progress: number
  processed: number
  total: number
  message: string
  error?: string
  /** 缓存构建耗时（毫秒） */
  buildMs?: number
}

/** 渲染层可用的 IPC API 契约 */
export interface ChatLogApi {
  listSources(): Promise<DbSource[]>
  /** 选择数据源范围：单个文件，或某目录下的全部数据库（合并） */
  selectSource(selection: SourceSelection): Promise<IndexStatus>
  indexStatus(): Promise<IndexStatus>
  /** 确保索引就绪：未加载时按默认规则（上次范围 / 数据最新目录）自动加载 */
  ensureIndex(): Promise<IndexStatus>
  rebuildIndex(): Promise<IndexStatus>
  onIndexProgress(cb: (status: IndexStatus) => void): () => void

  getConfig(): Promise<AppConfig>
  saveConfig(config: AppConfig): Promise<AppConfig>
  defaultDataDirs(): Promise<string[]>
  pickDataDir(): Promise<string | null>
  pickDataFile(): Promise<string | null>

  listChats(query: ChatQuery): Promise<ChatItem[]>
  chatMeta(chatId: string): Promise<ChatMeta | null>
  messagePage(query: MessageQuery): Promise<Page<MessageItem>>
  messageContext(chatId: string, messageId: string, radius?: number): Promise<MessageItem[]>
  searchGlobal(query: MessageQuery): Promise<SearchResponse>
  filterFacets(chatId: string): Promise<FacetResponse>
  /** 写入系统剪贴板（由主进程执行，返回是否成功） */
  copyText(text: string): Promise<boolean>

  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
}
