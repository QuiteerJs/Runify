import type { IpcMainInvokeEvent } from 'electron'
import type {
  Project,
  RunifyEvent,
  RunRequest,
  Settings,
  SystemTheme,
  TaskPlan,
  ThemeMode,
} from '../../shared/types'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { windows } from '@quiteer/electron-browser'
import { dialog, ipcMain, nativeTheme, shell } from 'electron'
import { IPC } from '../../shared/types'
import { detectEnv, fetchNodeDistVersions } from '../core/env-detect'
import { getRun, startAdhocRun, startRun, stopRun } from '../core/runner'
import {
  buildProject,
  readEnvFile,
  scanProject,
} from '../core/scanner'
import {
  defaultSettings,
  loadProjects,
  loadSettings,
  loadTasks,
  saveProjects,
  saveSettings,
  saveTasks,
} from '../core/store'

let projects: Project[] = []
let settings: Settings = { ...defaultSettings }
let tasks: TaskPlan[] = []

/**
 * 把主题档位写进 Electron 的 nativeTheme，让原生层（标题栏、应用菜单、
 * 原生右键菜单）与渲染层保持一致。只改渲染层的 CSS 变量是不够的。
 */
export function applyThemeSource(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

/** 读取当前外观快照：dark 是 Electron 按 themeSource 解析后的最终明暗 */
export function systemThemeSnapshot(): SystemTheme {
  return {
    dark: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource as ThemeMode,
  }
}

/** 主题变化事件载荷，供 nativeTheme 变化 / 手动切换后广播 */
export function systemThemeEvent(): RunifyEvent {
  const { dark, themeSource } = systemThemeSnapshot()
  return { kind: 'theme-changed', dark, themeSource }
}

export async function initState(): Promise<void> {
  projects = await loadProjects()
  settings = await loadSettings()
  tasks = await loadTasks()
  // 启动时立刻恢复上次持久化的档位，否则原生层会停留在系统默认外观
  applyThemeSource(settings.theme)
}

export function registerHandlers(): void {
  ipcMain.handle(IPC.getProjects, () => projects)

  ipcMain.handle(IPC.getSettings, () => settings)

  ipcMain.handle(IPC.saveSettings, async (_e, s: Settings) => {
    const changed = settings.theme !== s.theme
    settings = s
    await saveSettings(s)
    if (changed) {
      applyThemeSource(s.theme)
      // 设置弹窗走的是整份 Settings 回写而非 setTheme 通道，
      // 渲染层的 themeMode 不会自己变，必须广播过去同步，否则 UI 停在上一个档位
      windows.broadcast(IPC.event, systemThemeEvent())
    }
    return true
  })

  ipcMain.handle(IPC.getSystemTheme, () => systemThemeSnapshot())

  // 单独切换主题档位：不改动其它设置项，避免整份 Settings 回写覆盖并发编辑
  ipcMain.handle(IPC.setTheme, async (_e, mode: ThemeMode) => {
    if (settings.theme !== mode) {
      settings = { ...settings, theme: mode }
      applyThemeSource(mode)
      await saveSettings(settings)
      // 多窗口 / 托盘场景下同其它窗口同步（单窗口时广播自身也无害）
      windows.broadcast(IPC.event, systemThemeEvent())
    }
    return systemThemeSnapshot()
  })

  ipcMain.handle(IPC.importProject, async (_e, payload: { path: string }) => {
    const abs = path.resolve(payload.path)
    // 路径规范化后去重：macOS/Windows 默认大小写不敏感的 FS，按平台大小写归一比较
    const same = (a: string, b: string) =>
      process.platform === 'darwin' || process.platform === 'win32'
        ? a.toLowerCase() === b.toLowerCase()
        : a === b
    const exists = projects.find(p => same(path.resolve(p.path), abs))
    if (exists)
      return exists
    const scan = await scanProject(abs)
    const project = buildProject(abs, scan)
    projects.push(project)
    await saveProjects(projects)
    return project
  })

  ipcMain.handle(IPC.removeProject, async (_e, payload: { projectId: string }) => {
    projects = projects.filter(p => p.id !== payload.projectId)
    await saveProjects(projects)
    return true
  })

  ipcMain.handle(IPC.refreshProject, async (_e, payload: { projectId: string }) => {
    const p = projects.find(x => x.id === payload.projectId)
    if (!p)
      return null
    const scan = await scanProject(p.path)
    p.name = scan.name
    p.type = scan.type
    p.isMonorepo = scan.isMonorepo
    p.scripts = scan.scripts
    p.packages = scan.packages
    p.branch = scan.branch
    p.pm = scan.pm
    p.dependencies = scan.dependencies
    p.devDependencies = scan.devDependencies
    p.peerDependencies = scan.peerDependencies
    await saveProjects(projects)
    return p
  })

  ipcMain.handle(
    IPC.updateProject,
    async (_e, payload: { projectId: string, patch: Partial<Project> }) => {
      const idx = projects.findIndex(x => x.id === payload.projectId)
      if (idx < 0)
        return false
      // 只合并传入的字段，避免渲染进程回传整个 project（含无法克隆的 reactive proxy）
      projects[idx] = { ...projects[idx], ...payload.patch }
      await saveProjects(projects)
      return true
    },
  )

  ipcMain.handle(IPC.run, (_e: IpcMainInvokeEvent, req: RunRequest) => {
    const project = projects.find(x => x.id === req.projectId)
    if (!project)
      throw new Error(`project not found: ${req.projectId}`)
    return startRun(req, project, _e.sender, settings.logLimit)
  })

  ipcMain.handle(IPC.stop, (_e, payload: { runId: string }) => stopRun(payload.runId))

  // 环境管理：探测本机 Node 版本管理工具与运行时
  ipcMain.handle(IPC.envDetect, () => detectEnv())

  // 环境管理：执行独立命令（安装工具 / 装 node 版本 / 切默认），日志走事件流
  ipcMain.handle(IPC.envRunCommand, (_e: IpcMainInvokeEvent, payload: { command: string }) => {
    const command = payload?.command?.trim()
    if (!command)
      throw new Error('empty command')
    return startAdhocRun(command, _e.sender, settings.logLimit)
  })

  // 环境管理：官方源可安装的 Node 版本列表（供安装下拉选择）
  ipcMain.handle(IPC.envNodeVersions, () => fetchNodeDistVersions())

  ipcMain.handle(IPC.openFolder, async (_e, payload: { path: string }) => {
    shell.showItemInFolder(payload.path)
    return true
  })

  ipcMain.handle(IPC.openTerminal, (_e, payload: { path: string }) => {
    const target = payload.path
    try {
      if (process.platform === 'darwin') {
        spawn('open', ['-a', 'Terminal', target])
      }
      else if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', 'cmd', '/K', `cd /d "${target}"`])
      }
      else {
        spawn('x-terminal-emulator', ['--working-directory', target], {
          detached: true,
          stdio: 'ignore',
        }).on('error', () => shell.openPath(target))
      }
    }
    catch {
      shell.openPath(target)
    }
    return true
  })

  ipcMain.handle(IPC.openUrl, async (_e, payload: { url: string }) => {
    await shell.openExternal(payload.url)
    return true
  })

  ipcMain.handle(IPC.readEnv, async (_e, payload: { path: string }) => readEnvFile(payload.path))

  ipcMain.handle(IPC.exportLog, async (_e, payload: { runId: string }) => {
    const ctx = getRun(payload.runId)
    const text = ctx
      ? ctx.info.logs
          .map(l => `[${new Date(l.ts).toISOString()}] ${l.stream}: ${l.text}`)
          .join('')
      : ''
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `runify-log-${payload.runId}.txt`,
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    })
    if (canceled || !filePath)
      return null
    await fs.writeFile(filePath, text)
    return filePath
  })

  ipcMain.handle(IPC.pickFolder, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (canceled || filePaths.length === 0)
      return null
    return filePaths[0]
  })

  ipcMain.handle(IPC.getTasks, () => tasks)

  ipcMain.handle(IPC.saveTasks, async (_e, payload: { tasks: TaskPlan[] }) => {
    tasks = payload.tasks
    await saveTasks(tasks)
    return true
  })

  // 系统外观变化（浅/深色切换）时推送给渲染进程，供「跟随系统」档位联动。
  // 注意：即便用户锁定了 light/dark，Electron 仍可能触发本事件，
  // 此时 shouldUseDarkColors 反映的是「按 themeSource 解析后的结果」，可直接使用。
  nativeTheme.on('updated', () => {
    windows.broadcast(IPC.event, systemThemeEvent())
  })
}
