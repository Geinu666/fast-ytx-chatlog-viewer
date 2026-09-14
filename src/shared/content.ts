import type { MessageKind } from './types'

/**
 * 聊天记录内容解码器。
 *
 * 源库 `content` 字段存在两种形态：
 * 1. 明文，如 `好的`
 * 2. 字节数组编码，如 `encode229,165,189,231,154,132` —— 去掉 `encode` 前缀后
 *    按逗号拆分为十进制字节，再按 UTF-8 解码，得到 `好的`。
 *
 * 另有大量字段存放字面量 `undefined` / `null` 脏值，需统一归一化为空。
 */

const ENCODE_PREFIX = 'encode'

/** 判断是否为需要归一化的脏值 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const s = String(value).trim()
  return (
    s.length === 0 ||
    s === 'undefined' ||
    s === 'null' ||
    s === 'NULL' ||
    s === 'NaN'
  )
}

/** 归一化字段为可读文本，脏值返回空串 */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return isBlank(s) ? '' : s.trim()
}

/** 解码 content 字段（自动识别 encode 字节数组与明文） */
export function decodeContent(content: unknown): string {
  if (content === null || content === undefined) return ''
  const s = String(content)
  if (s.length === 0) return ''
  if (s.startsWith(ENCODE_PREFIX)) return decodeByteList(s.slice(ENCODE_PREFIX.length))
  return isBlank(s) ? '' : s
}

/** `229,165,189` -> `好的` */
function decodeByteList(body: string): string {
  if (!body) return ''
  const parts = body.split(',')
  const buffer = new Uint8Array(parts.length)
  let size = 0
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i]
    if (token.length === 0) continue
    const value = Number(token)
    if (!Number.isInteger(value) || value < 0 || value > 255) continue
    buffer[size++] = value
  }
  if (size === 0) return ''
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, size))
}

/** HTML 实体解码 */
export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number(dec)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
}

/** 剥离 HTML 标签，保留可读文本 */
export function stripHtml(html: string): string {
  const replaced = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(replaced)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const RE_IMG_SRC = /<img[^>]*\bsrc\s*=\s*["']([^"']+)["']/i
const RE_IMG_TAG = /<img\b[^>]*>/i
const RE_A_TAG = /<a\b[^>]*>/i
const RE_ATTR = (name: string): RegExp =>
  new RegExp(`<a\\b[^>]*?\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i')
/**
 * 本地缓存绝对路径：`<img path="...">` 与 `<a path="...">`。
 *
 * 标签内 `path` 常出现两次（实测 7806 条消息的两者不同）：
 * 第一个是本机缓存路径（与源库 `filePath` 列一致，形如
 * `C:\Users\<本机用户>\AppData\Roaming\boctx\<本机ID>\ChatImage\<消息ID>.png`），
 * 第二个是原发送方机器的路径。必须**非贪婪**取第一个，否则会展示别的机器上的路径。
 */
const RE_IMG_PATH = /<img\b[^>]*?\bpath\s*=\s*["']([^"']*)["']/i
const RE_A_PATH = /<a\b[^>]*?\bpath\s*=\s*["']([^"']*)["']/i
const RE_FILE_NAME = /<span[^>]*\bclass\s*=\s*["'][^"']*\bfile-name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
const RE_QUOTE = /<div[^>]*\bclass\s*=\s*["'][^"']*\bchat-quote\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
const RE_AT_SPAN = /<span[^>]*\bcontenteditable\s*=\s*["']false["'][^>]*>([\s\S]*?)<\/span>/gi
const RE_HAS_TAG = /<[a-z][a-z0-9]*\b[^>]*>/i
/**
 * 批量转发（合并转发）结构：
 *   <span class="message-object">王鹏和柯显聊天记录</span>
 *   <msg style="display:none">[ {子消息}, ... ]</msg>
 * 标题来自 message-object 的文本，正文是 `<msg>` 内的 JSON 数组。
 */
const RE_FORWARD_TITLE =
  /<span[^>]*\bclass\s*=\s*["'][^"']*\bmessage-object\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
const RE_FORWARD_MSG = /<msg\b[^>]*>([\s\S]*?)<\/msg>/i

/** 转发嵌套的最大解析深度，防止异常数据造成无限递归 */
const FORWARD_MAX_DEPTH = 5

/** 批量转发里的一条子消息 */
export interface ForwardNode {
  id: string
  name: string
  avatar: string
  timestamp: number
  strDate: string
  mine: boolean
  withdrawn: boolean
  /** 原始 messageType（已归一化为文本） */
  messageType: string
  /** 已解码的子消息内容，供渲染层复用既有解析逻辑 */
  raw: string
  /** 子消息的本地缓存绝对路径（已归一化），无则为空串 */
  localPath: string
  /** 子消息纯文本，用于展示 */
  text: string
  kind: MessageKind
  /** 子消息本身也是转发时的嵌套内容 */
  forward?: ForwardPayload
}

/** 一次转发（合并转发）的内容 */
export interface ForwardPayload {
  title: string
  count: number
  items: ForwardNode[]
}

/** 结构化解析结果 */
export interface ParsedMessage {
  kind: MessageKind
  /** 用于列表展示、检索与高亮的纯文本 */
  text: string
  imageUrl?: string
  fileUrl?: string
  fileName?: string
  filePath?: string
  /** 消息内容里记录的本地缓存绝对路径（`path` 属性），无则为空 */
  localPath?: string
  atList?: string[]
  quoteText?: string
  /** 批量转发内容（kind === 'forward' 时存在） */
  forward?: ForwardPayload
}

function basename(p: string): string {
  if (!p) return ''
  const normalized = p.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

/**
 * 归一化本地路径。
 *
 * 顶层消息里的路径是单反斜杠，但批量转发的子消息 content 被 JSON 二次转义，
 * 盘符后的反斜杠会成对出现（`D:\\yuantx\\3781\\...`）。
 * 仅在形如 `X:\\` 时折叠成单个反斜杠，避免破坏 `\\server\share` 这类 UNC 路径。
 */
export function normalizeLocalPath(path: string): string {
  if (!path) return ''
  if (/^[A-Za-z]:\\\\/.test(path)) return path.replace(/\\\\/g, '\\')
  return path
}

/** `path` 属性值归一化：脏值（undefined/null/空）返回 undefined */
function normalizePathAttr(match: RegExpExecArray | null): string | undefined {
  if (!match || !match[1]) return undefined
  const value = match[1].trim()
  if (isBlank(value)) return undefined
  const normalized = normalizeLocalPath(value)
  return normalized || undefined
}

function extractFileName(html: string): string {
  const span = RE_FILE_NAME.exec(html)
  if (span && span[1]) {
    const name = stripHtml(span[1])
    if (name) return name
  }
  const pathAttr = RE_ATTR('path').exec(html)
  if (pathAttr && pathAttr[1]) {
    const name = basename(pathAttr[1])
    if (name) return name
  }
  const href = RE_ATTR('href').exec(html)
  if (href && href[1]) {
    const name = basename(href[1])
    if (name && !name.includes('?')) return decodeURIComponent(name)
  }
  return ''
}

function parseFile(html: string): ParsedMessage {
  const fileName = extractFileName(html)
  const href = RE_ATTR('href').exec(html)
  const pathAttr = RE_A_PATH.exec(html)
  const local = normalizePathAttr(pathAttr)
  return {
    kind: 'file',
    text: fileName || '[文件]',
    fileName: fileName || undefined,
    fileUrl: href && href[1] ? href[1] : undefined,
    filePath: local,
    localPath: local
  }
}

function parseImage(html: string): ParsedMessage {
  const src = RE_IMG_SRC.exec(html)
  return {
    kind: 'image',
    text: '[图片]',
    imageUrl: src ? src[1] : undefined,
    localPath: normalizePathAttr(RE_IMG_PATH.exec(html))
  }
}

function parseAt(html: string): ParsedMessage {
  const atList: string[] = []
  RE_AT_SPAN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_AT_SPAN.exec(html)) !== null) {
    const name = stripHtml(m[1]).replace(/^@/, '').trim()
    if (name && !atList.includes(name)) atList.push(name)
  }
  const text = stripHtml(html)
  return { kind: 'at', text: text || '[提到某人]', atList: atList.length ? atList : undefined }
}

function parseQuote(html: string): ParsedMessage {
  const match = RE_QUOTE.exec(html)
  const quoteText = match ? stripHtml(match[1]) : ''
  const rest = match ? html.replace(match[0], '') : html
  const body = stripHtml(rest)
  const text = [quoteText ? `【引用】${quoteText}` : '', body].filter(Boolean).join(' ')
  return { kind: 'quote', text: text || '[引用消息]', quoteText: quoteText || undefined }
}

function parseEmoji(html: string): ParsedMessage {
  const src = RE_IMG_SRC.exec(html)
  const text = stripHtml(html)
  return {
    kind: 'emoji',
    text: text || '[表情]',
    imageUrl: src ? src[1] : undefined
  }
}

/** 在缺少 messageType 时，依据 HTML 结构猜测类型 */
function classifyByHtml(html: string): MessageKind {
  if (RE_QUOTE.test(html)) return 'quote'
  if (RE_FILE_NAME.test(html) || RE_A_TAG.test(html)) return 'file'
  if (RE_IMG_TAG.test(html)) return 'image'
  return 'text'
}

/** 布尔类脏值判断（兼容布尔 `true` 与字符串 `'true'`） */
function isTruthyFlag(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true'
}

/** 读取 `<msg>` 内的 JSON 数组；不是合法的转发载荷时返回 null */
function readForwardList(html: string): unknown[] | null {
  const match = RE_FORWARD_MSG.exec(html)
  if (!match || !match[1]) return null
  const payload = match[1].trim()
  if (!payload.startsWith('[')) return null

  let list: unknown
  try {
    list = JSON.parse(payload)
  } catch {
    return null
  }
  if (!Array.isArray(list) || list.length === 0) return null

  // 强校验：子消息必须带 content / messageType 字段，避免把普通文本误判为转发
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  const record = first as Record<string, unknown>
  if (!('content' in record) && !('messageType' in record)) return null
  return list
}

/** 把一条子消息转成 ForwardNode（递归解析其自身可能存在的转发结构） */
function toForwardNode(value: unknown, index: number, depth: number): ForwardNode | null {
  if (!value || typeof value !== 'object') return null
  const node = value as Record<string, unknown>
  const raw = decodeContent(node.content)
  const withdrawn = isTruthyFlag(node.withdraw) || isTruthyFlag(node.withDraw)
  const parsed = parseDecodedAt(raw, node.messageType, withdrawn, depth)

  return {
    id: cleanText(node.id) || `#${index}`,
    name: cleanText(node.name),
    avatar: cleanText(node.avatar),
    timestamp: Number(node.timestamp) || 0,
    strDate: cleanText(node.strDate),
    mine: isTruthyFlag(node.mine),
    withdrawn,
    messageType: cleanText(node.messageType),
    raw,
    localPath: normalizeLocalPath(parsed.localPath ?? cleanText(node.filePath)),
    text: parsed.text,
    kind: parsed.kind,
    forward: parsed.forward
  }
}

/** 识别并解析批量转发；不是转发或超过嵌套深度时返回 null */
function parseForward(html: string, depth: number): ParsedMessage | null {
  if (depth >= FORWARD_MAX_DEPTH) return null
  const list = readForwardList(html)
  if (!list) return null

  const items: ForwardNode[] = []
  for (let i = 0; i < list.length; i++) {
    const node = toForwardNode(list[i], i, depth + 1)
    if (node) items.push(node)
  }
  if (items.length === 0) return null

  const titleMatch = RE_FORWARD_TITLE.exec(html)
  const rawTitle = titleMatch ? stripHtml(titleMatch[1]) : ''
  const title = rawTitle || '聊天记录'
  return {
    kind: 'forward',
    text: title,
    forward: { title, count: items.length, items }
  }
}

/**
 * 将**已解码**的内容解析为结构化消息（供需要复用解码结果的调用方使用）。
 */
export function parseDecoded(
  decoded: string,
  messageType: unknown,
  withdrawn: boolean
): ParsedMessage {
  return parseDecodedAt(decoded, messageType, withdrawn, 0)
}

/** 带嵌套深度的解析实现（批量转发的子消息会递归调用） */
function parseDecodedAt(
  decoded: string,
  messageType: unknown,
  withdrawn: boolean,
  depth: number
): ParsedMessage {
  if (withdrawn) return { kind: 'withdrawn', text: '[消息已撤回]' }
  if (decoded.length === 0) return { kind: 'text', text: '' }

  const typeKey = isBlank(messageType) ? '' : String(messageType)
  const hasHtml = RE_HAS_TAG.test(decoded)

  // 批量转发按结构识别，必须先于 messageType 分派：
  // 实测同一结构会以 messageType=2（图片）与 messageType=5（文本）两种形式出现
  if (hasHtml) {
    const forward = parseForward(decoded, depth)
    if (forward) return forward
  }

  switch (typeKey) {
    case '1':
      return hasHtml ? parseFile(decoded) : { kind: 'file', text: decoded }
    case '2':
      return hasHtml ? parseImage(decoded) : { kind: 'image', text: '[图片]' }
    case '3':
      // 表情/富文本；少数记录为纯文本（如 IP、路径），按文本兜底
      return hasHtml ? parseEmoji(decoded) : { kind: 'text', text: decoded }
    case '4':
      // @提醒；少量记录为纯文本（如 UNC 路径），按文本兜底
      return hasHtml ? parseAt(decoded) : { kind: 'text', text: decoded }
    case '6':
      return hasHtml ? parseQuote(decoded) : { kind: 'quote', text: decoded }
    case '8':
      return { kind: 'system', text: stripHtml(decoded) || decoded }
    case '0':
    case '5':
      return { kind: 'text', text: stripHtml(decoded) || decoded }
    default:
      break
  }

  if (!hasHtml) return { kind: 'text', text: decoded }

  switch (classifyByHtml(decoded)) {
    case 'file':
      return parseFile(decoded)
    case 'image':
      return parseImage(decoded)
    case 'quote':
      return parseQuote(decoded)
    default:
      return { kind: 'text', text: stripHtml(decoded) || decoded }
  }
}

/**
 * 将原始 content 解析为结构化消息（内部完成 encode 解码）。
 * @param raw 原始 content 字段
 * @param messageType 原始 messageType 字段（可能为数字、字符串或脏值）
 * @param withdrawn 是否已撤回
 */
export function parseMessageContent(
  raw: unknown,
  messageType: unknown,
  withdrawn: boolean
): ParsedMessage {
  return parseDecoded(decodeContent(raw), messageType, withdrawn)
}

/** 将源库 messageType 与 type 归一化为语义化类型 */
export function resolveKind(
  raw: unknown,
  messageType: unknown,
  withdrawn: boolean
): MessageKind {
  return parseMessageContent(raw, messageType, withdrawn).kind
}
