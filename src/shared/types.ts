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
  | 'forward'
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
  /**
   * 消息对应的本地缓存绝对路径（图片 / 文件）。
   * 来源优先级：content 内嵌 `path` 属性 → 源库 `filePath` 列。空串表示未记录。
   */
  localPath: string
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
  /** 快照链基名，如 message3763.db 与 message3763-2026-09-14-10-14-37.db 同为 message3763 */
  baseName: string
  /** 文件名里的快照时间戳；0 表示无时间戳的「最新全量库」 */
  snapshotAt: number
  /** 是否因快照链折叠而未参与解析（仍会列在面板中，供单独选择） */
  folded: boolean
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
  /**
   * 目录选择时是否合并历史快照。
   * 默认 false：只解析无时间戳的「最新全量库」，历史快照整体折叠跳过
   * （带时间戳的快照是应用退出时保存的整库副本，内容被全量库包含）。
   * 检测到全量库消息减少（发生删除）时会自动置为 true 并提示。
   */
  mergeSnapshots?: boolean
  /**
   * 是否自动增量刷新索引。默认 true：每隔 autoRefreshIntervalSec 检测一次
   * 源库变化，仅在确有新数据时才真正构建。
   */
  autoRefreshEnabled?: boolean
  /** 自动刷新间隔（秒），默认 60，取值范围 10–3600 */
  autoRefreshIntervalSec?: number
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
  /** 因快照链折叠而未参与解析的历史快照（仅目录选择时可能出现） */
  foldedFiles: string[]
  /** 合并时因消息 ID 重复而被跳过的条数 */
  duplicateMessages: number
  /** 是否因检测到全量库消息减少而自动回退为「合并历史快照」模式 */
  autoMerged: boolean
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
  /** 每次真正执行构建后自增，渲染层据此感知数据变化并刷新会话 / 时间线 */
  revision: number
  /** 上次增量刷新完成的时间戳（0 表示尚未刷新过） */
  refreshedAt: number
}

/** 本地文件操作（打开 / 定位）结果 */
export interface LocalFileResult {
  ok: boolean
  /** 失败原因，成功时为空 */
  error?: string
}

/** 图片另存为入参：本地缓存优先，仅有远端链接时由主进程下载 */
export interface SaveImageInput {
  localPath?: string
  url?: string
  /** 建议文件名（含扩展名） */
  suggestedName: string
}

/** 本地文件定位入参：优先用数据库路径，其次按文件名在本机缓存目录中查找 */
export interface LocalFileQuery {
  /** 数据库记录的路径（可能是发送方机器的路径） */
  path?: string
  /** 文件名（通常是 content 里的 file-name，或路径 basename） */
  name?: string
}

/** 另存为结果 */
export interface SaveFileResult {
  ok: boolean
  /** 用户取消了保存对话框 */
  canceled?: boolean
  savedPath?: string
  error?: string
}

/** 渲染层可用的 IPC API 契约 */
export interface ChatLogApi {
  /** force=true 时忽略短时缓存强制重新扫描 */
  listSources(force?: boolean): Promise<DbSource[]>
  /** 汇总各源库统计（消息条数 / 最新数据时间）；force=true 时计算缺失项 */
  sourceStats(force?: boolean): Promise<DbSource[]>
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
  /** 用系统默认程序打开本地文件（仅本地路径，缺失不回落远端） */
  openLocalFile(path: string): Promise<LocalFileResult>
  /** 打开文件所在目录并选中该文件 */
  revealLocalFile(path: string): Promise<LocalFileResult>
  /** 图片另存为：本地缓存直接复制，仅有远端链接时下载后写入 */
  saveImageAs(input: SaveImageInput): Promise<SaveFileResult>
  /** 解析文件消息对应的本机真实路径；找不到时返回 null */
  resolveLocalFile(input: LocalFileQuery): Promise<string | null>
  /** 立即触发一次增量刷新（无变化时快速返回） */
  refreshIndex(): Promise<IndexStatus>

  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    /** 真正退出应用，不受「关闭时最小化到托盘」影响 */
    quit(): void
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
}
