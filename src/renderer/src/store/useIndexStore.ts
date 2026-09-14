import { create } from 'zustand'
import type { AppConfig, DbSource, IndexStatus, SourceSelection } from '@shared/types'

interface IndexState {
  status: IndexStatus | null
  sources: DbSource[]
  config: AppConfig | null
  defaultDirs: string[]
  initializing: boolean
  loadingSources: boolean
  statsLoading: boolean
  initialized: boolean

  init: () => Promise<void>
  refreshSources: (force?: boolean) => Promise<void>
  loadStats: (force?: boolean) => Promise<void>
  refreshConfig: () => Promise<void>
  selectSource: (selection: SourceSelection) => Promise<void>
  rebuild: () => Promise<void>
  setMergeSnapshots: (enabled: boolean) => Promise<void>
  addDataDir: () => Promise<void>
  addDataFile: () => Promise<void>
  removeDataDir: (path: string) => Promise<void>
  removeDataFile: (path: string) => Promise<void>
}

let unsubscribeProgress: (() => void) | null = null

export const useIndexStore = create<IndexState>((set, get) => ({
  status: null,
  sources: [],
  config: null,
  defaultDirs: [],
  initializing: false,
  loadingSources: false,
  statsLoading: false,
  initialized: false,

  async init() {
    if (get().initialized) return
    set({ initialized: true })

    if (unsubscribeProgress) unsubscribeProgress()
    unsubscribeProgress = window.api.onIndexProgress((status) => set({ status }))

    await get().refreshConfig()

    const [sources, status] = await Promise.all([
      window.api.listSources(),
      window.api.indexStatus()
    ])
    set({ sources, status })

    // 主进程启动时已尝试过一次，这里兜底：仍未就绪则按默认规则加载
    if (status.phase === 'idle' || status.phase === 'error') {
      await autoLoad(get)
    }
  },

  async refreshSources(force = false) {
    set({ loadingSources: true })
    try {
      const sources = await window.api.listSources(force)
      set({ sources })
    } finally {
      set({ loadingSources: false })
    }
  },

  /** 汇总各源库统计（消息条数 / 最新数据时间），结果由主进程持久化缓存 */
  async loadStats(force = false) {
    set({ statsLoading: true })
    try {
      const sources = await window.api.sourceStats(force)
      set({ sources })
    } finally {
      set({ statsLoading: false })
    }
  },

  async refreshConfig() {
    const [config, defaultDirs] = await Promise.all([
      window.api.getConfig(),
      window.api.defaultDataDirs()
    ])
    set({ config, defaultDirs })
  },

  async selectSource(selection: SourceSelection) {
    if (!selection?.path) return
    set({ initializing: true })
    try {
      const status = await window.api.selectSource(selection)
      set({ status })
    } finally {
      set({ initializing: false })
    }
  },

  async rebuild() {
    set({ initializing: true })
    try {
      const status = await window.api.rebuildIndex()
      set({ status })
    } finally {
      set({ initializing: false })
    }
  },

  /**
   * 切换「合并历史快照」。
   *
   * 默认关闭：只解析无时间戳的最新全量库（带时间戳的快照内容被它包含）。
   * 打开后会逐库合并去重，解码量成倍上升，因此保存后按当前范围重新加载一次。
   */
  async setMergeSnapshots(enabled: boolean) {
    const config = get().config ?? (await window.api.getConfig())
    if (config.mergeSnapshots === enabled) return

    const next = await window.api.saveConfig({ ...config, mergeSnapshots: enabled })
    set({ config: next, initializing: true })
    try {
      const current = get().status
      if (current?.selectionKind && current.selectionPath) {
        const status = await window.api.selectSource({
          kind: current.selectionKind,
          path: current.selectionPath
        })
        set({ status })
      }
    } finally {
      set({ initializing: false })
    }
  },

  async addDataDir() {
    const dir = await window.api.pickDataDir()
    if (!dir) return
    const config = get().config ?? (await window.api.getConfig())
    if (config.dataDirs.includes(dir)) return
    await window.api.saveConfig({ ...config, dataDirs: [...config.dataDirs, dir] })
    await get().refreshConfig()
    await get().refreshSources()
    // 新增目录后，若尚未加载任何数据源则自动选中该目录（合并查看）
    if (!isReady(get)) await get().selectSource({ kind: 'dir', path: dir })
    else await autoLoad(get)
  },

  async addDataFile() {
    const file = await window.api.pickDataFile()
    if (!file) return
    const config = get().config ?? (await window.api.getConfig())
    if (config.dataFiles.includes(file)) return
    await window.api.saveConfig({ ...config, dataFiles: [...config.dataFiles, file] })
    await get().refreshConfig()
    await get().refreshSources()
    if (!isReady(get)) await get().selectSource({ kind: 'file', path: file })
    else await autoLoad(get)
  },

  async removeDataDir(path: string) {
    const config = get().config ?? (await window.api.getConfig())
    await window.api.saveConfig({
      ...config,
      dataDirs: config.dataDirs.filter((item) => item !== path)
    })
    await get().refreshConfig()
    await get().refreshSources()
  },

  async removeDataFile(path: string) {
    const config = get().config ?? (await window.api.getConfig())
    await window.api.saveConfig({
      ...config,
      dataFiles: config.dataFiles.filter((item) => item !== path)
    })
    await get().refreshConfig()
    await get().refreshSources()
  }
}))

function isReady(get: () => IndexState): boolean {
  return get().status?.phase === 'ready'
}

/** 尚未加载任何数据源时，让主进程按默认规则自动加载 */
async function autoLoad(get: () => IndexState): Promise<void> {
  if (isReady(get)) return
  const status = await window.api.ensureIndex()
  if (status) useIndexStore.setState({ status })
}
