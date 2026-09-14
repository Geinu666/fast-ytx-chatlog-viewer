/**
 * 本地图片协议地址。
 *
 * 与主进程 `src/main/media/protocol.ts` 的约定必须保持一致：
 *   ytx-media://local/?p=<encodeURIComponent(绝对路径)>
 */
export function localMediaUrl(path: string): string {
  return `ytx-media://local/?p=${encodeURIComponent(path)}`
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i

/** 从本地路径或远端链接推断「另存为」的默认文件名 */
export function suggestImageName(localPath?: string, url?: string, fallbackId = ''): string {
  const fromLocal = localPath ? (localPath.split(/[\\/]/).pop() ?? '') : ''
  if (fromLocal) return fromLocal

  if (url) {
    const name = url.split('?')[0].split('#')[0].split('/').pop() ?? ''
    if (IMAGE_EXT.test(name)) return decodeURIComponent(name)
  }
  return `图片-${fallbackId || Date.now()}.png`
}
