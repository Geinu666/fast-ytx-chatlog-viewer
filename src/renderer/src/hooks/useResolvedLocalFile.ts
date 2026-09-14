import { useEffect, useState } from 'react'

/**
 * 解析文件消息对应的**本机真实路径**。
 *
 * 数据库里记录的路径多半是发送方机器的路径，主进程会在本机缓存目录
 * （`%APPDATA%\boctx\<用户ID>\File`）中按文件名查找真实文件。
 *
 * 返回值：
 * - `undefined`：解析中（过渡态，界面不要下结论）；
 * - `null`：本机没有这个文件；
 * - `string`：本机真实绝对路径。
 */
const resolvedCache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

function keyOf(path?: string, name?: string): string {
  return `${path ?? ''}\u0000${name ?? ''}`
}

function probe(key: string, path?: string, name?: string): Promise<string | null> {
  const cached = resolvedCache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)

  const running = inflight.get(key)
  if (running) return running

  const task = window.api
    .resolveLocalFile({ path: path || undefined, name: name || undefined })
    .then((resolved) => {
      resolvedCache.set(key, resolved)
      return resolved
    })
    .catch(() => null)
    .finally(() => inflight.delete(key))

  inflight.set(key, task)
  return task
}

export function useResolvedLocalFile(path?: string, name?: string): string | null | undefined {
  const key = keyOf(path, name)
  const [resolved, setResolved] = useState<string | null | undefined>(() =>
    resolvedCache.get(key)
  )

  useEffect(() => {
    if (!path && !name) {
      setResolved(null)
      return
    }

    const cached = resolvedCache.get(key)
    if (cached !== undefined) {
      setResolved(cached)
      return
    }

    let alive = true
    void probe(key, path, name).then((value) => {
      if (alive) setResolved(value)
    })
    return () => {
      alive = false
    }
  }, [key, path, name])

  return resolved
}
