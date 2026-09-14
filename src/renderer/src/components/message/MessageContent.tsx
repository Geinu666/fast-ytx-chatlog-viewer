import { useMemo, useState } from 'react'
import {
  AtSign,
  ExternalLink,
  FileText,
  ImageOff,
  Loader2,
  Quote,
  Smile
} from 'lucide-react'
import { parseMessageContent } from '@shared/content'
import type { MessageItem } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { Highlight } from '@renderer/lib/highlight'

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

function ImageBlock({ url, keyword }: { url?: string; keyword?: string }) {
  const [attempting, setAttempting] = useState(false)
  const [failed, setFailed] = useState(false)

  if (url && attempting && !failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <img
          src={url}
          alt="聊天图片"
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-64 max-w-[320px] rounded-xl border border-line/10 object-contain"
        />
        <span className="text-micro text-ink-600">{hostOf(url)}</span>
      </div>
    )
  }

  return (
    <div className="flex w-[260px] flex-col gap-2 rounded-xl border border-line/10 bg-surface-900/50 p-3">
      <div className="flex items-center gap-2 text-ink-400">
        {failed ? (
          <ImageOff size={16} className="text-state-warn" />
        ) : (
          <Smile size={16} className="text-brand-cyan" />
        )}
        <span className="text-body">
          <Highlight text={failed ? '[图片] 内网资源不可访问' : '[图片]'} keyword={keyword} />
        </span>
      </div>
      {url && <span className="truncate text-micro text-ink-600">{url}</span>}
      <div className="flex items-center gap-2">
        {url && !failed && (
          <button
            type="button"
            className="btn"
            onClick={() => setAttempting(true)}
            disabled={attempting}
          >
            {attempting ? <Loader2 size={11} className="animate-spin" /> : <Smile size={11} />}
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
  filePath,
  fileUrl,
  keyword
}: {
  fileName?: string
  filePath?: string
  fileUrl?: string
  keyword?: string
}) {
  const label = fileName || filePath?.split(/[\\/]/).pop() || '文件'
  return (
    <div className="flex w-[280px] flex-col gap-2 rounded-xl border border-line/10 bg-surface-900/50 p-3">
      <div className="flex items-center gap-2">
        <FileText size={16} className="shrink-0 text-brand-violet" />
        <span className="min-w-0 flex-1 truncate text-body text-ink-100">
          <Highlight text={label} keyword={keyword} />
        </span>
      </div>
      {filePath && (
        <span className="truncate text-micro text-ink-600" title={filePath}>
          {filePath}
        </span>
      )}
      <div className="flex items-center gap-2">
        {fileUrl && <ExternalButton url={fileUrl} />}
        <span className="text-micro text-ink-600">{hostOf(fileUrl) || '本地文件'}</span>
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

  if (parsed.kind === 'image') {
    return <ImageBlock url={parsed.imageUrl} keyword={keyword} />
  }

  if (parsed.kind === 'file') {
    return (
      <FileBlock
        fileName={parsed.fileName}
        filePath={parsed.filePath}
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
