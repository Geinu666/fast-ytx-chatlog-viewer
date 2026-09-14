import { create } from 'zustand'
import type { AppConfig, DbSource, IndexStatus } from '@shared/types'

interface IndexState {
  status: IndexStatus | null
  sources: DbSource[]
  config: AppConfig | null
  defaultDirs: string[]
  initializing: boolean
  loadingSources: boolean
  initialized: boolean

  init: () => Promise<void>
  refreshSources: () => Promise<void>
  refreshConfig: () => Promise<void>
  selectSource: (path: string) => Promise<void>
  rebuild: () => Promise<void>
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

    if ((status.phase === 'idle' || status.phase === 'error') && sources.length > 0) {
      const fallback = sources.find((item) => item.valid)
      if (fallback) await get().selectSource(fallback.path)
    }
  },

  async refreshSources() {
    set({ loadingSources: true })
    try {
      const sources = await window.api.listSources()
      set({ sources })
    } finally {
      set({ loadingSources: false })
    }
  },

  async refreshConfig() {
    const [config, defaultDirs] = await Promise.all([
      window.api.getConfig(),
      window.api.defaultDataDirs()
    ])
    set({ config, defaultDirs })
  },

  async selectSource(path: string) {
    if (!path) return
    set({ initializing: true })
    try {
      const status = await window.api.selectSource(path)
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

  async addDataDir() {
    const dir = await window.api.pickDataDir()
    if (!dir) return
    const config = get().config ?? (await window.api.getConfig())
    if (config.dataDirs.includes(dir)) return
    await window.api.saveConfig({ ...config, dataDirs: [...config.dataDirs, dir] })
    await get().refreshConfig()
    await get().refreshSources()
    await autoLoad(get)
  },

  async addDataFile() {
    const file = await window.api.pickDataFile()
    if (!file) return
    const config = get().config ?? (await window.api.getConfig())
    if (config.dataFiles.includes(file)) return
    await window.api.saveConfig({ ...config, dataFiles: [...config.dataFiles, file] })
    await get().refreshConfig()
    await get().refreshSources()
    await autoLoad(get)
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

/** 尚未加载任何数据源时，自动加载第一个可用项 */
async function autoLoad(get: () => IndexState): Promise<void> {
  const status = get().status
  if (status && status.phase === 'ready') return
  const fallback = get().sources.find((item) => item.valid)
  if (fallback) await get().selectSource(fallback.path)
}
