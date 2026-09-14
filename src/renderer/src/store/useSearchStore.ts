import { create } from 'zustand'
import type { SearchResponse } from '@shared/types'

const SEARCH_LIMIT = 300

interface SearchState {
  open: boolean
  keyword: string
  loading: boolean
  result: SearchResponse | null
  openPanel: () => void
  closePanel: () => void
  setKeyword: (value: string) => void
  run: (keyword?: string) => Promise<void>
  loadMore: () => Promise<void>
}

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  keyword: '',
  loading: false,
  result: null,

  openPanel() {
    set({ open: true })
  },

  closePanel() {
    set({ open: false })
  },

  setKeyword(value: string) {
    set({ keyword: value })
  },

  async run(keyword?: string) {
    const target = (keyword ?? get().keyword).trim()
    set({ keyword: target })
    if (!target) {
      set({ result: null, loading: false })
      return
    }
    set({ loading: true })
    const result = await window.api.searchGlobal({ keyword: target, limit: SEARCH_LIMIT })
    set({ result, loading: false })
  },

  async loadMore() {
    const { result, keyword, loading } = get()
    if (!result || !result.hasMore || !result.nextCursor || loading) return
    set({ loading: true })
    const next = await window.api.searchGlobal({
      keyword,
      limit: SEARCH_LIMIT,
      cursor: result.nextCursor
    })

    const merged = new Map(result.groups.map((group) => [group.chatId, group]))
    for (const group of next.groups) {
      const existing = merged.get(group.chatId)
      if (existing) {
        existing.items = [...existing.items, ...group.items]
        existing.count += group.count
      } else {
        merged.set(group.chatId, group)
      }
    }

    set({
      loading: false,
      result: {
        ...next,
        total: result.total,
        groups: [...merged.values()].sort((a, b) => b.count - a.count)
      }
    })
  }
}))
