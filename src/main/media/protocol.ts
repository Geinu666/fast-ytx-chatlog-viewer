import { net, protocol } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 本地聊天图片协议。
 *
 * 渲染层无法直接访问本地文件系统，这里注册一个私有 scheme 把数据库里记录的
 * 本地缓存图片流式提供给 `<img>`。URL 约定：
 *   ytx-media://local/?p=<encodeURIComponent(绝对路径)>
 *
 * 仅允许「真实存在的图片文件」，其余一律 404 / 403，避免渲染层任意读取磁盘。
 */
export const MEDIA_SCHEME = 'ytx-media'

/** 允许通过协议读取的图片扩展名 */
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.ico',
  '.svg'
])

/**
 * 注册 scheme 权限。**必须在 app ready 之前调用**，
 * 否则注册无效（图片会被 webRequest 当作不安全资源拦截）。
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

/** 注册协议处理器（app ready 之后调用） */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    try {
      const target = resolveRequestPath(request.url)
      if (!target) return new Response('Bad Request', { status: 400 })
      if (!IMAGE_EXTENSIONS.has(extname(target).toLowerCase())) {
        return new Response('Forbidden', { status: 403 })
      }
      if (!isFile(target)) return new Response('Not Found', { status: 404 })
      return net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
  })
}

/** 从请求 URL 中取出本地绝对路径（searchParams 已完成百分号解码） */
function resolveRequestPath(rawUrl: string): string | null {
  const url = new URL(rawUrl)
  if (url.hostname && url.hostname !== 'local') return null
  const value = url.searchParams.get('p')
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isFile(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isFile()
  } catch {
    return false
  }
}
