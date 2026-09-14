/**
 * 本地图片协议地址。
 *
 * 与主进程 `src/main/media/protocol.ts` 的约定必须保持一致：
 *   ytx-media://local/?p=<encodeURIComponent(绝对路径)>
 */
export function localMediaUrl(path: string): string {
  return `ytx-media://local/?p=${encodeURIComponent(path)}`
}
