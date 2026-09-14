const pad = (value: number): string => String(value).padStart(2, '0')

/** 1234567890 -> 12:34:56 */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 1234567890 -> 2026-09-14 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 1234567890 -> 2026-09-14 12:34 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${formatDate(timestamp)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 会话列表使用的时间显示：今天显示时刻，今年显示月日，更早显示年月日 */
export function formatListTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 将 YYYY-MM-DD 渲染为更友好的日期分隔文案 */
export function formatDateLabel(strDate: string): string {
  if (!strDate) return '未知日期'
  const parsed = new Date(`${strDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return strDate

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const yesterday = new Date(today.getTime() - 86400000)
  const yesterdayKey = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`

  if (strDate === todayKey) return `今天 · ${strDate}`
  if (strDate === yesterdayKey) return `昨天 · ${strDate}`
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()]
  return `${strDate} · ${week}`
}

/** 字节数格式化 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

/** 数字千分位 / 万级缩写 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value < 10000) return value.toLocaleString('zh-CN')
  return `${(value / 10000).toFixed(1)} 万`
}

/** 消息类型中文名 */
export const KIND_LABEL: Record<string, string> = {
  text: '文本',
  image: '图片',
  file: '文件',
  at: '@提醒',
  quote: '引用',
  emoji: '表情',
  system: '系统',
  withdrawn: '撤回',
  forward: '转发',
  unknown: '其他'
}

/** 会话类型中文名 */
export function chatKindLabel(kind: string): string {
  if (kind === 'single') return '单聊'
  if (kind === 'group') return '群聊'
  return '会话'
}
