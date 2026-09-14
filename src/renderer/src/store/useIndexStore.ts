import { create } from 'zustand'
import type { DbSource, IndexStatus } from '@shared/types'

interface IndexState {
  status: IndexStatus | null
  sources: DbSource[]
  initialized: boolean
  init: () => Promise<void>
  refreshSources: () => Promise<void>
  selectSource: (path: string) => Promise<void>
  rebuild: () => Promise<void>
}

let unsubscribeProgress: (() => void) | null = null

export const useIndexStore = create<IndexState>((set, get) => ({
  status: null,
  sources: [],
  initialized: false,

  async init() {
    if (get().initialized) return
    set({ initialized: true })

    if (unsubscribeProgress) unsubscribeProgress()
    unsubscribeProgress = window.api.onIndexProgress((status) => set({ status }))

    const sources = await window.api.listSources()
    const status = await window.api.indexStatus()
    set({ sources, status })

    if ((status.phase === 'idle' || status.phase === 'error') && sources.length > 0) {
      const fallback = sources.find((item) => item.valid)
      if (fallback) await get().selectSource(fallback.path)
    }
  },

  async refreshSources() {
    const sources = await window.api.listSources()
    set({ sources })
  },

  async selectSource(path: string) {
    if (!path) return
    const status = await window.api.selectSource(path)
    set({ status })
  },

  async rebuild() {
    const status = await window.api.rebuildIndex()
    set({ status })
  }
}))
