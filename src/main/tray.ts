import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'

/**
 * 系统托盘。
 *
 * 关闭窗口时不再直接退出，而是隐藏到托盘；只有托盘菜单的「退出应用」
 * 或恢复弹窗的「退出程序」（`win:quit`）才真正结束进程。
 * 托盘创建失败（无可用图标等）时自动退回「关闭即退出」的默认行为，
 * 避免窗口被隐藏后无法找回。
 */

let tray: Tray | null = null
/** 正在退出：close 事件据此放行，不再拦截为隐藏 */
let quitting = false
/** 本次运行是否已提示过「已最小化到托盘」 */
let hiddenHintShown = false

const APP_TITLE = '猿通讯聊天记录查看器'

/** 托盘是否可用 */
export function trayReady(): boolean {
  return tray !== null && !tray.isDestroyed()
}

export function isQuitting(): boolean {
  return quitting
}

/** 标记进入退出流程（`before-quit` 等系统级退出路径也需置位） */
export function markQuitting(): void {
  quitting = true
}

/** 真正退出应用：托盘菜单与恢复弹窗的「退出程序」共用此路径 */
export function quitApp(): void {
  markQuitting()
  app.quit()
}

function showMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 创建托盘图标与右键菜单；无可用图标时不创建 */
export function createAppTray(win: BrowserWindow, iconPath?: string): void {
  if (trayReady()) return

  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  if (image.isEmpty()) return

  try {
    tray = new Tray(image)
  } catch {
    tray = null
    return
  }

  tray.setToolTip(APP_TITLE)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showMainWindow(win) },
      { type: 'separator' },
      { label: '退出应用', click: () => quitApp() }
    ])
  )

  // 单击 / 双击 / 点击气泡都恢复窗口；只显示不隐藏，双重事件不会互相抵消
  tray.on('click', () => showMainWindow(win))
  tray.on('double-click', () => showMainWindow(win))
  tray.on('balloon-click', () => showMainWindow(win))
}

/** 隐藏到托盘，并在本次运行首次隐藏时给出一次气泡提示 */
export function hideToTray(win: BrowserWindow): void {
  win.hide()

  if (hiddenHintShown || !trayReady()) return
  hiddenHintShown = true
  if (process.platform !== 'win32') return

  try {
    tray!.displayBalloon({
      title: APP_TITLE,
      content: '已最小化到系统托盘，双击托盘图标可重新打开，右键可退出应用。'
    })
  } catch {
    // 系统禁用了通知气泡时忽略
  }
}
