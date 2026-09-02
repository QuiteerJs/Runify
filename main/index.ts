import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { windows } from '@quiteer/electron-browser'
import { Ipc } from '@quiteer/electron-ipc'

import { menus } from '@quiteer/electron-menu'
import { trays } from '@quiteer/electron-tray'
import { app, screen } from 'electron'
import {
  loadWindowState,
  saveWindowState,
  saveWindowStateSync,
} from './core/store'
import {
  initState,
  registerHandlers,
  systemThemeSnapshot,
} from './ipc/handlers'
// @quiteer/electron-preload 在运行时导出预加载脚本的绝对路径（CJS string）
const require = createRequire(import.meta.url)
const preload = require('@quiteer/electron-preload') as string

// 主进程产物是 ESM（electron.mjs），没有 __dirname 全局，按 import.meta.url 推导
const __dirname = fileURLToPath(new URL('.', import.meta.url))

const isDev = process.env.NODE_ENV === 'development'

const loadUrl = isDev
  ? `http://localhost:${process.env.RENDER_PORT}`
  : `file://${resolve(__dirname, 'index.html')}`

const APP_NAME = 'Runify'

/**
 * 窗口底色：必须与 render/style.css 里的 --bg 保持一致。
 * 窗口创建到 Vue 挂载之间有一段「空文档」时间，不设底色会露出白色，
 * 深色主题下就是一次刺眼的白闪。
 */
const WINDOW_BG = { dark: '#16171a', light: '#f3f4f6' } as const

/**
 * 定位 resources/ 下的资源文件（图标等）。
 *
 * 注意层级：打包后主进程产物 __dirname（ESM 下由 import.meta.url 推导）是
 * `.../Contents/Resources/app/dist/resource`，
 * 而图标实际落在 `.../Contents/Resources/app/resources`（由 builderConfig.files 的
 * `resources/**` 带入）—— 因此需要向上**两级**，写 `../resources` 会解到
 * `app/dist/resources` 这个不存在的目录，图标加载会静默失败。
 *
 * 这里按候选路径依次探测，兼容 dev（__dirname 可能是项目根下的 dist/resource）
 * 与 packaged 两种布局；全部不存在时返回主候选，让调用方照常失败而不是拿到空值。
 */
function resourceFile(name: string): string {
  const candidates = [
    resolve(__dirname, '../../resources', name), // packaged: app/resources ；dev: <root>/resources
    resolve(__dirname, '../../../resources', name), // packaged 兜底: Contents/Resources/resources（extraResources）
    resolve(__dirname, '../resources', name), // 主进程产物若直接放在 app/ 或 dist/ 下
    resolve(process.cwd(), 'resources', name), // dev 从项目根启动时
  ]
  return candidates.find(p => existsSync(p)) ?? candidates[0]
}

/** 上次记录的位置是否仍在某个屏幕的可见区域内（拔掉外接屏后不应把窗口丢到屏幕外） */
function isOnScreen(x: number, y: number): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height
  })
}

/** 记录窗口尺寸/位置/最大化状态：拖动缩放节流写盘，关闭时同步写盘 */
function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const snapshot = () => {
    // getNormalBounds 在最大化时返回「还原后」的 bounds，因此尺寸始终记的是正常态尺寸
    const b = win.getNormalBounds()
    return {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      maximized: win.isMaximized() || win.isFullScreen(),
    }
  }

  const schedule = () => {
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      saveWindowState(snapshot()).catch(() => {})
    }, 400)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    saveWindowStateSync(snapshot())
  })
}

async function createMainWindow() {
  const st = await loadWindowState()
  const restorePos = st.x !== null && st.y !== null && isOnScreen(st.x, st.y)
  // initState() 已经把持久化的档位写进 nativeTheme，这里读到的是解析后的最终明暗
  const { dark } = systemThemeSnapshot()
  const win = windows.create({
    name: 'main',
    width: Math.max(st.width, 900),
    height: Math.max(st.height, 600),
    minWidth: 900,
    minHeight: 600,
    x: restorePos ? st.x! : undefined,
    y: restorePos ? st.y! : undefined,
    center: !restorePos,
    url: loadUrl,
    backgroundColor: WINDOW_BG[dark ? 'dark' : 'light'],
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
    openDevTools: isDev,
  })

  if (st.maximized)
    win.target.maximize()

  trackWindowState(win.target)
  return win
}

/** 标准应用菜单：macOS 用 appMenu，Windows/Linux 用「文件/编辑/视图/帮助」 */
function buildAppMenu(): MenuItemConstructorOptions[] {
  const aboutLabel = `关于 ${APP_NAME}`
  const appMenu: MenuItemConstructorOptions = {
    role: 'appMenu',
    submenu: [
      { role: 'about', label: aboutLabel },
      { type: 'separator' },
      { role: 'quit', label: '退出' },
    ],
  }
  const fileMenu: MenuItemConstructorOptions = {
    label: '文件',
    submenu: [{ role: 'quit', label: '退出' }],
  }
  const editMenu: MenuItemConstructorOptions = { role: 'editMenu' }
  const viewMenu: MenuItemConstructorOptions = { role: 'viewMenu' }
  const windowMenu: MenuItemConstructorOptions = { role: 'windowMenu' }
  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [{ role: 'about', label: aboutLabel }],
  }

  if (process.platform === 'darwin')
    return [appMenu, editMenu, viewMenu, windowMenu, helpMenu]
  return [fileMenu, editMenu, viewMenu, helpMenu]
}

app.whenReady().then(async () => {
  // 先加载持久化的工程列表与全局设置，再注册 IPC
  await initState()
  registerHandlers()

  // IPC 通道预设（electron-modules/ipc）
  Ipc.init()

  // 应用菜单（electron-modules/menu）
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Runify',
    iconPath: resourceFile('icon.png'),
  })
  menus.create({
    name: 'app',
    template: buildAppMenu(),
  })

  // 主窗口（electron-modules/browser + preload 桥接）
  await createMainWindow()

  // 系统托盘（electron-modules/tray）
  trays.create({
    name: 'main',
    icon: {
      idle: resourceFile('tray.png'),
      syncing: resourceFile('tray-syncing.png'),
    },
    tooltip: 'Runify',
    contextMenu: [
      { label: '显示主窗口', click: () => windows.focus('main') },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ],
  })
})
