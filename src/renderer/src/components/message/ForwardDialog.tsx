import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Forward, X } from 'lucide-react'
import { parseDecoded, type ForwardNode } from '@shared/content'
import type { MessageItem } from '@shared/types'
import { Avatar } from '@renderer/components/common/Avatar'
import { formatMessageTime } from '@renderer/lib/format'
import { localMediaUrl } from '@renderer/lib/localMedia'
import { useForwardStore } from '@renderer/store/useForwardStore'
import { useLightboxStore, type LightboxImage } from '@renderer/store/useLightboxStore'
import { MessageContent } from './MessageContent'

/** 把转发子消息映射成 MessageItem，以复用既有内容渲染（图片 / 文件 / 引用等） */
function toMessageItem(node: ForwardNode, index: number): MessageItem {
  return {
    id: node.id,
    rowId: index,
    chatId: '',
    chatType: '',
    fromId: '',
    name: node.name,
    avatar: node.avatar,
    kind: node.kind,
    messageType: node.messageType,
    isMine: node.mine,
    isWithdrawn: node.withdrawn,
    at: '',
    timestamp: node.timestamp,
    strDate: node.strDate,
    text: node.text,
    raw: node.raw,
    localPath: node.localPath
  }
}

function ForwardRow({ node, index }: { node: ForwardNode; index: number }) {
  const item = useMemo(() => toMessageItem(node, index), [node, index])

  return (
    <li className="flex gap-2.5">
      <Avatar name={item.name || '未知'} src={item.avatar} size={34} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-micro text-ink-600">
          <span className="max-w-[45%] truncate">{item.name || '未知成员'}</span>
          <span className="shrink-0">{formatMessageTime(item.timestamp)}</span>
        </div>
        <div className="w-fit max-w-full rounded-2xl border border-line/10 bg-surface-800/70 px-3.5 py-2">
          <MessageContent item={item} />
        </div>
      </div>
    </li>
  )
}

/** 批量转发浏览弹窗：支持多层嵌套下钻与返回上一级 */
export function ForwardDialog() {
  const stack = useForwardStore((state) => state.stack)
  const goBack = useForwardStore((state) => state.goBack)
  const close = useForwardStore((state) => state.close)

  const current = stack.length > 0 ? stack[stack.length - 1] : null
  const depth = stack.length

  // 当前层转发记录中的图片集合，供「查看大图」弹窗前后切换
  const galleryImages = useMemo<LightboxImage[]>(() => {
    if (!current) return []
    return current.items
      .map((node): LightboxImage | null => {
        if (node.kind !== 'image') return null
        const parsed = parseDecoded(node.raw, node.messageType, node.withdrawn)
        const src = node.localPath ? localMediaUrl(node.localPath) : parsed.imageUrl
        if (!src) return null
        return {
          id: node.id,
          src,
          localPath: node.localPath || undefined,
          url: parsed.imageUrl,
          title: `${node.name || '未知'} · ${formatMessageTime(node.timestamp)}`
        }
      })
      .filter((image): image is LightboxImage => image !== null)
  }, [current])

  const setDialogImages = useLightboxStore((state) => state.setDialogImages)
  useEffect(() => {
    if (!current) {
      setDialogImages(null)
      return
    }
    setDialogImages(galleryImages)
    return () => setDialogImages(null)
  }, [current, galleryImages, setDialogImages])

  useEffect(() => {
    if (!current) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 图片查看弹窗打开时，Esc 交给它自己处理
      if (useLightboxStore.getState().images.length > 0) return
      event.stopPropagation()
      if (depth > 1) goBack()
      else close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [current, depth, goBack, close])

  if (!current) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="关闭转发内容"
        className="absolute inset-0 cursor-default"
        onClick={close}
      />

      <div className="glass-card relative flex max-h-[84vh] w-full max-w-[720px] animate-fade-up flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line/10 px-4 py-3">
          <Forward size={15} className="shrink-0 text-brand-violet" />
          <span className="min-w-0 flex-1 truncate text-subheading text-ink-100">
            {current.title}
          </span>
          <span className="shrink-0 text-micro text-ink-600">共 {current.count} 条</span>
          <button type="button" className="btn" onClick={close}>
            <X size={12} />
            关闭
          </button>
        </header>

        {depth > 1 && (
          <div className="flex items-center gap-2 border-b border-line/10 bg-surface-800/40 px-4 py-1.5">
            <button type="button" className="btn shrink-0" onClick={goBack} title="返回上一级转发">
              <ChevronLeft size={11} />
              返回上一级
            </button>
            <span className="truncate text-micro text-ink-600">
              {stack.map((layer) => layer.title).join(' / ')}
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <ul className="flex flex-col gap-3">
            {current.items.map((node, index) => (
              <ForwardRow key={`${node.id}-${index}`} node={node} index={index} />
            ))}
          </ul>
        </div>

        <footer className="border-t border-line/10 px-4 py-2 text-micro text-ink-600">
          图片双击打开、右键另存为；文件可打开或定位到所在目录
        </footer>
      </div>
    </div>,
    document.body
  )
}
