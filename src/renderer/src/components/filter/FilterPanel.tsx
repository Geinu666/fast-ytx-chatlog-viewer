import { useMemo, useState } from 'react'
import { CalendarRange, RotateCcw, Search, SlidersHorizontal, Users } from 'lucide-react'
import type { MessageKind } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { KIND_LABEL, chatKindLabel, formatCount, formatDate } from '@renderer/lib/format'
import { useChatStore } from '@renderer/store/useChatStore'

const QUICK_RANGES: Array<{ label: string; days: number }> = [
  { label: '今天', days: 0 },
  { label: '近 7 天', days: 6 },
  { label: '近 30 天', days: 29 },
  { label: '近一年', days: 364 }
]

/** 右栏：会话概览与多维筛选（发送人 / 消息类型 / 日期范围） */
export function FilterPanel() {
  const chatMeta = useChatStore((state) => state.chatMeta)
  const facets = useChatStore((state) => state.facets)
  const facetsLoading = useChatStore((state) => state.facetsLoading)
  const filters = useChatStore((state) => state.filters)
  const toggleFromId = useChatStore((state) => state.toggleFromId)
  const toggleKind = useChatStore((state) => state.toggleKind)
  const setDateRange = useChatStore((state) => state.setDateRange)
  const clearFilters = useChatStore((state) => state.clearFilters)

  const [senderKeyword, setSenderKeyword] = useState('')

  const visibleSenders = useMemo(() => {
    const list = facets?.senders ?? []
    const keyword = senderKeyword.trim().toLowerCase()
    if (!keyword) return list
    return list.filter(
      (sender) =>
        sender.name.toLowerCase().includes(keyword) ||
        sender.fromId.toLowerCase().includes(keyword)
    )
  }, [facets, senderKeyword])

  const activeCount =
    filters.fromIds.length +
    filters.kinds.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0)

  const applyQuickRange = (days: number): void => {
    const to = formatDate(Date.now())
    const from = formatDate(Date.now() - days * 86400000)
    void setDateRange(from, to)
  }

  const kinds: Array<{ kind: MessageKind; count: number }> = facets?.kinds ?? []

  return (
    <aside className="flex h-full w-[292px] shrink-0 flex-col border-l border-line/10 bg-surface-800/45">
      <header className="flex items-center gap-2 border-b border-line/10 px-4 py-3">
        <SlidersHorizontal size={13} className="text-brand-indigo" />
        <span className="text-subheading">筛选与概览</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-brand-indigo/25 px-1.5 text-micro text-ink-100">
            {activeCount}
          </span>
        )}
        <button
          type="button"
          className="btn ml-auto"
          onClick={() => void clearFilters()}
          disabled={activeCount === 0}
        >
          <RotateCcw size={11} />
          重置
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <section className="glass-card mb-3 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-micro text-ink-600">
            <Users size={11} /> 会话概览
          </h3>
          {chatMeta ? (
            <dl className="flex flex-col gap-1.5 text-micro">
              <div className="flex items-center justify-between">
                <dt className="text-ink-600">名称</dt>
                <dd className="max-w-[170px] truncate text-ink-100">{chatMeta.name}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-600">类型</dt>
                <dd className="text-ink-100">{chatKindLabel(chatMeta.kind)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-600">消息总数</dt>
                <dd className="text-ink-100">{formatCount(chatMeta.messageCount)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-600">参与人数</dt>
                <dd className="text-ink-100">{formatCount(chatMeta.memberCount)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-600">时间跨度</dt>
                <dd className="text-ink-100">
                  {chatMeta.firstDate || '—'} ~ {chatMeta.lastDate || '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-micro text-ink-600">请先选择一个会话</p>
          )}
        </section>

        <section className="mb-3">
          <h3 className="mb-2 text-micro text-ink-600">消息类型</h3>
          <div className="flex flex-wrap gap-1.5">
            {kinds.length === 0 && <span className="text-micro text-ink-600">暂无数据</span>}
            {kinds.map((entry) => {
              const active = filters.kinds.includes(entry.kind)
              return (
                <button
                  key={entry.kind}
                  type="button"
                  onClick={() => void toggleKind(entry.kind)}
                  className={cn('chip', active && 'chip-active')}
                >
                  {KIND_LABEL[entry.kind] ?? entry.kind}
                  <span className="text-ink-600">{entry.count}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="mb-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-micro text-ink-600">
            <CalendarRange size={11} /> 日期范围
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                className="chip"
                onClick={() => applyQuickRange(range.days)}
              >
                {range.label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() => void setDateRange('', '')}
            >
              全部时间
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              value={filters.dateFrom}
              min={facets?.dateRange.from || undefined}
              max={filters.dateTo || facets?.dateRange.to || undefined}
              onChange={(event) => void setDateRange(event.target.value, filters.dateTo)}
              className="field"
            />
            <span className="text-micro text-ink-600">至</span>
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || facets?.dateRange.from || undefined}
              max={facets?.dateRange.to || undefined}
              onChange={(event) => void setDateRange(filters.dateFrom, event.target.value)}
              className="field"
            />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-micro text-ink-600">发送人</h3>
          <div className="relative mb-2">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
            />
            <input
              value={senderKeyword}
              onChange={(event) => setSenderKeyword(event.target.value)}
              placeholder="按姓名或 ID 过滤"
              className="field pl-7"
            />
          </div>

          {facetsLoading && <p className="text-micro text-ink-600">正在统计发送人…</p>}

          <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto pr-1">
            {visibleSenders.map((sender) => {
              const active = filters.fromIds.includes(sender.fromId)
              return (
                <button
                  key={sender.fromId}
                  type="button"
                  onClick={() => void toggleFromId(sender.fromId)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200',
                    active ? 'bg-brand-indigo/20' : 'hover:bg-surface-700/50'
                  )}
                >
                  <span
                    className={cn(
                      'h-3 w-3 shrink-0 rounded border transition-colors',
                      active
                        ? 'border-brand-indigo bg-brand-indigo'
                        : 'border-line/40 bg-transparent'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-micro text-ink-400">
                    {sender.name || sender.fromId}
                  </span>
                  <span className="shrink-0 text-micro text-ink-600">{sender.count}</span>
                </button>
              )
            })}
            {!facetsLoading && visibleSenders.length === 0 && (
              <p className="text-micro text-ink-600">没有匹配的发送人</p>
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
