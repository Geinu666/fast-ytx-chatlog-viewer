import { useMemo, useState, type MouseEvent } from 'react'
import {
  AtSign,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderSearch,
  ImageOff,
  Quote,
  Smile
} from 'lucide-react'
import { parseMessageContent } from '@shared/content'
import type { MessageItem } from '@shared/types'
import { ContextMenu } from '@renderer/components/common/ContextMenu'
import { cn } from '@renderer/lib/cn'
import { Highlight } from '@renderer/lib/highlight'
import { localMediaUrl, suggestImageName } from '@renderer/lib/localMedia'
import { useResolvedLocalFile } from '@renderer/hooks/useResolvedLocalFile'
import { useLightboxStore } from '@renderer/store/useLightboxStore'
import { useUiStore } from '@renderer/store/useUiStore'
import { ForwardBlock } from './ForwardBlock'

interface MessageContentProps {
  item: MessageItem
  keyword?: string
}

function ExternalButton({ url }: { url: string }) {
  return (
    <button
      type="button"
      onClick={() => window.open(url, '_blank')}
      className="btn"
      title={url}
    >
      <ExternalLink size={11} />
      打开链接
    </button>
  )
}

function ImageBlock({
  itemId,
  url,
  localPath,
  keyword
}: {
  /** 消息 ID，用于在图片查看弹窗中定位当前项 */
  itemId: string
  url?: string
  localPath?: string
  keyword?: string
}) {
  // local：优先本地缓存；remote：回退远端链接；idle：无本地缓存待手动尝试；failed：均不可用
  const [stage, setStage] = useState<'local' | 'remote' | 'idle' | 'failed'>(() =>
    localPath ? 'local' : 'idle'
  )
  const showToast = useUiStore((state) => state.showToast)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const src =
    stage === 'local' && localPath ? localMediaUrl(localPath) : stage === 'remote' && url ? url : ''

  const handleError = (): void => {
    // 本地缓存读不到就自动回退远端；远端再失败才判定不可访问
    setStage(stage === 'local' && url ? 'remote' : 'failed')
  }

  /** 双击：在应用内弹窗中查看大图（可前后切换、缩放） */
  const openViewer = (): void => {
    useLightboxStore.getState().openById(itemId)
  }

  /** 用系统默认程序 / 系统浏览器打开原图 */
  const openWithSystem = async (): Promise<void> => {
    if (localPath) {
      const result = await window.api.openLocalFile(localPath)
      if (!result.ok) showToast(result.error || '打开失败')
      return
    }
    if (url) window.open(url, '_blank')
  }

  /** 另存为：本地缓存优先，仅远端链接时由主进程下载 */
  const saveAs = async (): Promise<void> => {
    const result = await window.api.saveImageAs({
      localPath: localPath || undefined,
      url,
      suggestedName: suggestImageName(localPath, url)
    })
    if (result.canceled) return
    showToast(result.ok ? '图片已保存' : result.error || '保存失败')
  }

  const copyImageLink = async (): Promise<void> => {
    if (!url) return
    const ok = await window.api.copyText(url)
    showToast(ok ? '已复制图片链接' : '复制失败')
  }

  /** 右键图片：阻止冒泡，使用图片自身菜单（消息气泡菜单另有同样入口） */
  const handleContextMenu = (event: MouseEvent<HTMLImageElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY })
  }

  if (src) {
    return (
      <>
        <div className="group flex max-w-[320px] flex-col gap-1">
          <img
            src={src}
            alt="聊天图片"
            loading="lazy"
            onError={handleError}
            onDoubleClick={openViewer}
            onContextMenu={handleContextMenu}
            title="双击查看大图 · 右键另存为"
            className="max-h-64 max-w-[320px] cursor-zoom-in rounded-xl border border-line/10 object-contain transition-colors duration-200 group-hover:border-brand-cyan/35"
          />
          {/* 不展示地址，仅在悬停时提示可用操作 */}
          <span className="text-micro text-ink-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            双击查看大图 · 右键另存为
          </span>
        </div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              {
                id: 'viewer',
                label: '查看大图',
                onSelect: openViewer
              },
              {
                id: 'openSystem',
                label: '用系统程序打开',
                dividerBefore: true,
                onSelect: () => void openWithSystem()
              },
              {
                id: 'saveAs',
                label: '图片另存为…',
                onSelect: () => void saveAs()
              },
              {
                id: 'copyLink',
                label: '复制图片链接',
                dividerBefore: true,
                disabled: !url,
                onSelect: () => void copyImageLink()
              }
            ]}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex w-[260px] flex-col gap-2 rounded-xl border border-line/10 bg-surface-900/50 p-3">
      <div className="flex items-center gap-2 text-ink-400">
        {stage === 'failed' ? (
          <ImageOff size={16} className="text-state-warn" />
        ) : (
          <Smile size={16} className="text-brand-cyan" />
        )}
        <span className="text-body">
          <Highlight
            text={stage === 'failed' ? '[图片] 本地与远端均不可访问' : '[图片]'}
            keyword={keyword}
          />
        </span>
      </div>
      {(localPath || url) && (
        <span className="truncate text-micro text-ink-600" title={localPath || url}>
          {localPath || url}
        </span>
      )}
      <div className="flex items-center gap-2">
        {url && stage !== 'failed' && (
          <button type="button" className="btn" onClick={() => setStage('remote')}>
            <Smile size={11} />
            尝试加载图片
          </button>
        )}
        {url && <ExternalButton url={url} />}
      </div>
    </div>
  )
}

function FileBlock({
  fileName,
  localPath,
  fileUrl,
  isMine,
  keyword
}: {
  fileName?: string
  localPath?: string
  fileUrl?: string
  /** 是否本人发送：决定「未下载」的措辞 */
  isMine: boolean
  keyword?: string
}) {
  const showToast = useUiStore((state) => state.showToast)
  // 数据库里的路径多为发送方机器的路径，需在本机缓存目录中按文件名定位真实文件
  const resolved = useResolvedLocalFile(localPath, fileName)
  const localFile = resolved ?? ''
  const checking = resolved === undefined
  const missing = resolved === null
  const label = fileName || localPath?.split(/[\\/]/).pop() || '文件'
  const missingText = isMine ? '本地无该文件缓存' : '未下载到本地'

  /** 打开本机文件：定位不到时仅提示，不回落远端链接 */
  const openLocal = async (): Promise<void> => {
    if (!localFile) {
      showToast(checking ? '正在查找本地文件…' : missingText)
      return
    }
    const result = await window.api.openLocalFile(localFile)
    if (!result.ok) showToast(result.error || '打开失败')
  }

  /** 打开所在目录并选中该文件 */
  const revealLocal = async (): Promise<void> => {
    if (!localFile) {
      showToast(checking ? '正在查找本地文件…' : missingText)
      return
    }
    const result = await window.api.revealLocalFile(localFile)
    if (!result.ok) showToast(result.error || '打开所在路径失败')
  }

  return (
    <div
      onDoubleClick={() => void openLocal()}
      title={localFile ? `${localFile}（双击打开）` : checking ? '正在查找本地文件…' : missingText}
      className="flex w-[280px] flex-col gap-2 rounded-xl border border-line/10 bg-surface-900/50 p-3"
    >
      <div className="flex items-center gap-2">
        <FileText size={16} className="shrink-0 text-brand-violet" />
        <span className="min-w-0 flex-1 truncate text-body text-ink-100">
          <Highlight text={label} keyword={keyword} />
        </span>
        {missing && (
          <span className="shrink-0 rounded-full bg-surface-600/70 px-1.5 text-micro text-ink-400">
            {isMine ? '本地无缓存' : '未下载'}
          </span>
        )}
      </div>

      {/* 仅在本机确实定位到文件时才展示路径，避免展示其他机器上的路径造成误解 */}
      {localFile && (
        <span className="truncate text-micro text-ink-600" title={localFile}>
          {localFile}
        </span>
      )}
      {missing && <span className="text-micro text-ink-600">{missingText}，未显示路径</span>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn('btn', !localFile && 'cursor-not-allowed opacity-55')}
          disabled={!localFile}
          onClick={() => void openLocal()}
          title={localFile ? '用系统默认程序打开（双击卡片亦可）' : missingText}
        >
          <FolderOpen size={11} />
          打开
        </button>
        <button
          type="button"
          className={cn('btn', !localFile && 'cursor-not-allowed opacity-55')}
          disabled={!localFile}
          onClick={() => void revealLocal()}
          title={localFile ? '打开所在目录并选中该文件' : missingText}
        >
          <FolderSearch size={11} />
          打开文件所在路径
        </button>
        {fileUrl && <ExternalButton url={fileUrl} />}
      </div>
    </div>
  )
}

function QuoteBlock({
  quoteText,
  body,
  keyword
}: {
  quoteText: string
  body: string
  keyword?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 rounded-lg border-l-2 border-brand-violet/70 bg-surface-900/45 px-2.5 py-1.5">
        <Quote size={11} className="mt-1 shrink-0 text-brand-violet" />
        <span className="line-clamp-3 whitespace-pre-wrap break-words text-micro text-ink-600">
          {quoteText}
        </span>
      </div>
      <span className="whitespace-pre-wrap break-words text-body text-ink-100">
        <Highlight text={body} keyword={keyword} />
      </span>
    </div>
  )
}

/** 消息内容渲染：按类型差异化展示，全部经结构化解析，不注入 HTML */
export function MessageContent({ item, keyword }: MessageContentProps) {
  const parsed = useMemo(
    () => parseMessageContent(item.raw, item.messageType, item.isWithdrawn),
    [item.raw, item.messageType, item.isWithdrawn]
  )

  if (parsed.kind === 'system') {
    return <span className="whitespace-pre-wrap break-words text-micro text-ink-600">{parsed.text}</span>
  }

  if (parsed.kind === 'withdrawn') {
    return <span className="text-micro italic text-ink-600">{parsed.text}</span>
  }

  if (parsed.kind === 'forward' && parsed.forward) {
    return <ForwardBlock payload={parsed.forward} keyword={keyword} />
  }

  if (parsed.kind === 'image') {
    return (
      <ImageBlock
        itemId={item.id}
        url={parsed.imageUrl}
        localPath={item.localPath || parsed.localPath}
        keyword={keyword}
      />
    )
  }

  if (parsed.kind === 'file') {
    return (
      <FileBlock
        fileName={parsed.fileName}
        localPath={item.localPath || parsed.localPath}
        fileUrl={parsed.fileUrl}
        isMine={item.isMine}
        keyword={keyword}
      />
    )
  }

  if (parsed.kind === 'quote' && parsed.quoteText) {
    const body = parsed.text.replace(`【引用】${parsed.quoteText}`, '').trim()
    return <QuoteBlock quoteText={parsed.quoteText} body={body} keyword={keyword} />
  }

  if (parsed.kind === 'emoji' && parsed.imageUrl) {
    return (
      <span className="flex flex-col gap-1">
        <span className="whitespace-pre-wrap break-words text-body text-ink-100">
          <Highlight text={parsed.text} keyword={keyword} />
        </span>
      </span>
    )
  }

  if (parsed.kind === 'at') {
    return (
      <span className="flex items-start gap-1.5">
        <AtSign size={13} className="mt-0.5 shrink-0 text-brand-cyan" />
        <span className="whitespace-pre-wrap break-words text-body text-ink-100">
          <Highlight text={parsed.text} keyword={keyword} />
        </span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'whitespace-pre-wrap break-words text-body text-ink-100',
        !parsed.text && 'text-ink-600'
      )}
    >
      <Highlight text={parsed.text || '[空消息]'} keyword={keyword} />
    </span>
  )
}
