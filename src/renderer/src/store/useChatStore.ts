import { create } from 'zustand'
import type {
  ChatItem,
  ChatMeta,
  FacetResponse,
  MessageItem,
  MessageKind,
  MessageQuery
} from '@shared/types'

export type ChatScope = 'all' | 'single' | 'group' | 'top'

export interface MessageFilters {
  fromIds: string[]
  kinds: MessageKind[]
  dateFrom: string
  dateTo: string
}

const EMPTY_FILTERS: MessageFilters = {
  fromIds: [],
  kinds: [],
  dateFrom: '',
  dateTo: ''
}

const PAGE_SIZE = 120

function filterParams(filters: MessageFilters): Partial<MessageQuery> {
  return {
    fromIds: filters.fromIds.length ? filters.fromIds : undefined,
    kinds: filters.kinds.length ? filters.kinds : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined
  }
}

function cursorOf(item: MessageItem): string {
  return `${item.timestamp}:${item.rowId}`
}

interface ChatState {
  chats: ChatItem[]
  chatKeyword: string
  chatScope: ChatScope
  loadingChats: boolean

  activeChatId: string | null
  chatMeta: ChatMeta | null
  facets: FacetResponse | null
  facetsLoading: boolean

  messages: MessageItem[]
  loadingMessages: boolean
  olderCursor: string | null
  hasMoreOlder: boolean
  lastQueryMs: number
  /** 是否需要在下次渲染后恢复滚动位置（向上加载历史时使用） */
  pendingAnchor: boolean

  filters: MessageFilters
  inChatKeyword: string
  matchIds: string[]
  matchIndex: number
  highlightId: string | null

  loadChats: () => Promise<void>
  setChatKeyword: (value: string) => void
  setChatScope: (scope: ChatScope) => void

  selectChat: (chatId: string) => Promise<void>
  reloadMessages: () => Promise<void>
  loadOlder: () => Promise<void>

  applyFilters: (next: Partial<MessageFilters>) => Promise<void>
  toggleFromId: (fromId: string) => Promise<void>
  toggleKind: (kind: MessageKind) => Promise<void>
  setDateRange: (from: string, to: string) => Promise<void>
  clearFilters: () => Promise<void>

  runInChatSearch: (keyword: string) => Promise<void>
  stepMatch: (delta: number) => Promise<void>
  jumpToMessage: (chatId: string, messageId: string) => Promise<void>
  setHighlight: (id: string | null) => void
  consumeAnchor: () => boolean
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  chatKeyword: '',
  chatScope: 'all',
  loadingChats: false,

  activeChatId: null,
  chatMeta: null,
  facets: null,
  facetsLoading: false,

  messages: [],
  loadingMessages: false,
  olderCursor: null,
  hasMoreOlder: false,
  lastQueryMs: 0,
  pendingAnchor: false,

  filters: EMPTY_FILTERS,
  inChatKeyword: '',
  matchIds: [],
  matchIndex: -1,
  highlightId: null,

  async loadChats() {
    set({ loadingChats: true })
    const chats = await window.api.listChats({
      keyword: get().chatKeyword,
      scope: get().chatScope
    })
    set({ chats, loadingChats: false })

    const active = get().activeChatId
    const exists = active && chats.some((chat) => chat.id === active)
    if (!exists && chats.length > 0) {
      await get().selectChat(chats[0].id)
    }
  },

  setChatKeyword(value: string) {
    set({ chatKeyword: value })
  },

  setChatScope(scope: ChatScope) {
    set({ chatScope: scope })
  },

  async selectChat(chatId: string) {
    if (!chatId) return
    set({
      activeChatId: chatId,
      messages: [],
      chatMeta: null,
      facets: null,
      facetsLoading: true,
      filters: EMPTY_FILTERS,
      inChatKeyword: '',
      matchIds: [],
      matchIndex: -1,
      highlightId: null,
      olderCursor: null,
      hasMoreOlder: false
    })

    const [meta, facets] = await Promise.all([
      window.api.chatMeta(chatId),
      window.api.filterFacets(chatId)
    ])
    set({ chatMeta: meta, facets, facetsLoading: false })

    await get().reloadMessages()
  },

  async reloadMessages() {
    const chatId = get().activeChatId
    if (!chatId) return
    set({ loadingMessages: true })
    const started = performance.now()
    const page = await window.api.messagePage({
      chatId,
      ...filterParams(get().filters),
      cursor: null,
      direction: 'older',
      limit: PAGE_SIZE
    })
    set({
      messages: page.items,
      olderCursor: page.nextCursor,
      hasMoreOlder: page.hasMore,
      loadingMessages: false,
      lastQueryMs: Math.round(performance.now() - started)
    })
  },

  async loadOlder() {
    const state = get()
    if (
      !state.activeChatId ||
      !state.olderCursor ||
      !state.hasMoreOlder ||
      state.loadingMessages
    ) {
      return
    }
    set({ loadingMessages: true, pendingAnchor: true })
    const page = await window.api.messagePage({
      chatId: state.activeChatId,
      ...filterParams(state.filters),
      cursor: state.olderCursor,
      direction: 'older',
      limit: PAGE_SIZE
    })
    set({
      messages: [...page.items, ...get().messages],
      olderCursor: page.nextCursor,
      hasMoreOlder: page.hasMore,
      loadingMessages: false
    })
  },

  async applyFilters(next: Partial<MessageFilters>) {
    set({ filters: { ...get().filters, ...next } })
    await get().reloadMessages()
  },

  async toggleFromId(fromId: string) {
    const current = get().filters.fromIds
    const next = current.includes(fromId)
      ? current.filter((id) => id !== fromId)
      : [...current, fromId]
    await get().applyFilters({ fromIds: next })
  },

  async toggleKind(kind: MessageKind) {
    const current = get().filters.kinds
    const next = current.includes(kind)
      ? current.filter((item) => item !== kind)
      : [...current, kind]
    await get().applyFilters({ kinds: next })
  },

  async setDateRange(from: string, to: string) {
    await get().applyFilters({ dateFrom: from, dateTo: to })
  },

  async clearFilters() {
    await get().applyFilters(EMPTY_FILTERS)
  },

  async runInChatSearch(keyword: string) {
    const trimmed = keyword.trim()
    set({ inChatKeyword: trimmed, matchIds: [], matchIndex: -1, highlightId: null })
    const chatId = get().activeChatId
    if (!trimmed || !chatId) return

    const response = await window.api.searchGlobal({
      chatId,
      keyword: trimmed,
      ...filterParams(get().filters),
      limit: 500
    })
    const ids = response.groups
      .flatMap((group) => group.items.map((item) => item.id))
      .reverse()

    set({ matchIds: ids, matchIndex: ids.length ? 0 : -1 })
    if (ids.length > 0) await get().jumpToMessage(chatId, ids[0])
  },

  async stepMatch(delta: number) {
    const { matchIds, matchIndex, activeChatId } = get()
    if (!matchIds.length || !activeChatId) return
    let next = matchIndex + delta
    if (next < 0) next = matchIds.length - 1
    if (next >= matchIds.length) next = 0
    set({ matchIndex: next })
    await get().jumpToMessage(activeChatId, matchIds[next])
  },

  async jumpToMessage(chatId: string, messageId: string) {
    if (get().activeChatId !== chatId) {
      await get().selectChat(chatId)
    }
    set({ loadingMessages: true })
    const items = await window.api.messageContext(chatId, messageId, 40)
    set({
      messages: items,
      olderCursor: items.length ? cursorOf(items[0]) : null,
      hasMoreOlder: items.length > 0,
      loadingMessages: false,
      highlightId: messageId,
      pendingAnchor: false
    })
  },

  setHighlight(id: string | null) {
    set({ highlightId: id })
  },

  consumeAnchor() {
    const pending = get().pendingAnchor
    if (pending) set({ pendingAnchor: false })
    return pending
  }
}))
