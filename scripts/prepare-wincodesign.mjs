/**
 * 预置 electron-builder 的 winCodeSign 缓存。
 *
 * 背景：设置 Windows exe 图标 / 版本信息时，app-builder 的 rcedit 需要
 * winCodeSign 工具包。该 7z 包内的 `darwin/10.12/lib/*.dylib` 是 macOS 符号链接，
 * 在没有管理员权限或未开启「开发者模式」的 Windows 上解压会失败
 * （CreateSymbolicLink: 客户端没有所需的特权）。
 *
 * 这里改为自行下载并解压，且**排除 darwin 目录**（Windows 构建用不到），
 * 解压结果放到 app-builder 期望的缓存位置：
 *   %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0
 *
 * 若该目录已存在则直接跳过。脚本失败不阻断构建（electron-builder 仍会自行尝试）。
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const VERSION = '2.6.0'
const ARTIFACT = `winCodeSign-${VERSION}`

const require = createRequire(import.meta.url)

function log(message) {
  process.stdout.write(`[winCodeSign] ${message}\n`)
}

async function main() {
  if (process.platform !== 'win32') return

  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) {
    log('未找到 LOCALAPPDATA，跳过')
    return
  }

  const cacheRoot = join(localAppData, 'electron-builder', 'Cache', 'winCodeSign')
  const target = join(cacheRoot, ARTIFACT)
  if (existsSync(join(target, 'windows-10'))) {
    log(`缓存已就绪：${target}`)
    return
  }

  mkdirSync(cacheRoot, { recursive: true })

  const mirror =
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??
    'https://github.com/electron-userland/electron-builder-binaries/releases/download/'
  const url = `${mirror}${ARTIFACT}/${ARTIFACT}.7z`
  const archive = join(cacheRoot, `${ARTIFACT}.download.7z`)
  const staging = join(cacheRoot, `${ARTIFACT}.extracting`)

  log(`下载 ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))

  let sevenZip
  try {
    sevenZip = require('7zip-bin').path7za
  } catch {
    throw new Error('未找到 7zip-bin，无法解压')
  }

  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  log('解压（排除 darwin 目录，规避 macOS 符号链接权限问题）')
  const result = spawnSync(sevenZip, ['x', archive, `-o${staging}`, '-xr!darwin', '-y'], {
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    throw new Error(`7za 退出码 ${result.status}`)
  }

  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  renameSync(staging, target)
  rmSync(archive, { force: true })
  log(`完成：${target}`)
}

main().catch((error) => {
  log(`预置失败（将交由 electron-builder 自行处理）：${error.message}`)
})
