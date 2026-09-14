import { Fragment, type ReactNode } from 'react'

interface HighlightProps {
  text: string
  keyword?: string
  className?: string
}

/**
 * 关键字高亮（不注入 HTML，全部通过 React 元素渲染）。
 * 大小写不敏感匹配，保留原文大小写。
 */
export function Highlight({ text, keyword, className }: HighlightProps): ReactNode {
  const needle = (keyword ?? '').trim()
  if (!needle || !text) return <>{text}</>

  const haystack = text.toLowerCase()
  const target = needle.toLowerCase()
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0

  while (cursor < text.length) {
    const found = haystack.indexOf(target, cursor)
    if (found === -1) {
      nodes.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>)
      break
    }
    if (found > cursor) {
      nodes.push(<Fragment key={key++}>{text.slice(cursor, found)}</Fragment>)
    }
    nodes.push(
      <mark key={key++} className={className ?? 'highlight-mark'}>
        {text.slice(found, found + target.length)}
      </mark>
    )
    cursor = found + target.length
  }

  return <>{nodes}</>
}
