import { useMemo, useState } from 'react'
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
import { cn } from '@renderer/lib/cn'
import { Highlight } from '@renderer/lib/highlight'
import { localMediaUrl } from '@renderer/lib/localMedia'
import { useUiStore } from '@renderer/store/useUiStore'

interface MessageContentProps {
  item: MessageItem
  keyword?: string
}

function hostOf(url?: string): string {
  if (!url) return ''
  const match = /^https?:\/\/([^/]+)/i.exec(url)
  return match ? match[1] : url
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
  url,
  localPath,
  keyword
}: {
  url?: string
  localPath?: string
  keyword?: string
}) {
  // local：优先本地缓存；remote：回退远端链接；idle：无本地缓存待手动尝试；failed：均不可用
  const [stage, setStage] = useState<'local' | 'remote' | 'idle' | 'failed'>(() =>
    localPath ? 'local' : 'idle'
  )

  const src =
    stage === 'local' && localPath ? localMediaUrl(localPath) : stage === 'remote' && url ? url : ''

  const handleError = (): void => {
    // 本地缓存读不到就自动回退远端；远端再失败才判定不可访问
    setStage(stage === 'local' && url ? 'remote' : 'failed')
  }

  if (src) {
    return (
      <div className="flex flex-col gap-1.5">
        <img
          src={src}
          alt="聊天图片"
          loading="lazy"
          onError={handleError}
          className="max-h-64 max-w-[320px] rounded-xl border border-line/10 object-contain"
        />
        <span
          className="max-w-[320px] truncate text-micro text-ink-600"
          title={stage === 'local' ? localPath : src}
        >
          {stage === 'local' ? '本地缓存' : hostOf(src)}
        </span>
      </div>
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
  keyword
}: {
  fileName?: string
  localPath?: string
  fileUrl?: string
  keyword?: string
}) {
  const showToast = useUiStore((state) => state.showToast)
  const label = fileName || localPath?.split(/[\\/]/).pop() || '文件'

  /** 打开本地缓存文件：缺失时仅提示，不回落远端链接 */
  const openLocal = async (): Promise<void> => {
    if (!localPath) {
      showToast('本地缓存不存在')
      return
    }
    const result = await window.api.openLocalFile(localPath)
    if (!result.ok) showToast(result.error || '打开失败')
  }

  /** 打开所在目录并选中该文件 */
  const revealLocal = async (): Promise<void> => {
    if (!localPath) {
      showToast('本地缓存不存在')
      return
    }
    const result = await window.api.revealLocalFile(localPath)
    if (!result.ok) showToast(result.error || '打开所在路径失败')
  }

  return (
    <div
      onDoubleClick={() => void openLocal()}
      title={localPath ? `${localPath}（双击打开）` : '本地缓存不存在'}
      className="flex w-[280px] flex-col gap-2 rounded-xl border border-line/10 bg-surface-900/50 p-3"
    >
      <div className="flex items-center gap-2">
        <FileText size={16} className="shrink-0 text-brand-violet" />
        <span className="min-w-0 flex-1 truncate text-body text-ink-100">
          <Highlight text={label} keyword={keyword} />
        </span>
      </div>
      {localPath && (
        <span className="truncate text-micro text-ink-600" title={localPath}>
          {localPath}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => void openLocal()}
          title={localPath ? '用系统默认程序打开（双击卡片亦可）' : '本地缓存不存在'}
        >
          <FolderOpen size={11} />
          打开
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void revealLocal()}
          title={localPath ? '打开所在目录并选中该文件' : '本地缓存不存在'}
        >
          <FolderSearch size={11} />
          打开文件所在路径
        </button>
        {fileUrl && <ExternalButton url={fileUrl} />}
      </div>
      {!localPath && (
        <span className="text-micro text-ink-600">数据库中未记录本地缓存路径</span>
      )}
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

  if (parsed.kind === 'image') {
    return (
      <ImageBlock
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
