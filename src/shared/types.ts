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
}

/** 索引缓存状态 */
export interface IndexStatus {
  phase: 'idle' | 'building' | 'ready' | 'error'
  sourcePath: string | null
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
  selectSource(path: string): Promise<IndexStatus>
  indexStatus(): Promise<IndexStatus>
  rebuildIndex(): Promise<IndexStatus>
  onIndexProgress(cb: (status: IndexStatus) => void): () => void

  listChats(query: ChatQuery): Promise<ChatItem[]>
  chatMeta(chatId: string): Promise<ChatMeta | null>
  messagePage(query: MessageQuery): Promise<Page<MessageItem>>
  messageContext(chatId: string, messageId: string, radius?: number): Promise<MessageItem[]>
  searchGlobal(query: MessageQuery): Promise<SearchResponse>
  filterFacets(chatId: string): Promise<FacetResponse>

  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
}
