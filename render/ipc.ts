import type {
  EnvVar,
  LogEntry,
  Project,
  RunifyEvent,
  RunInfo,
  RunRequest,
  Settings,
  SystemTheme,
  ThemeMode,
} from '../shared/types'
import { IPC } from '../shared/types'

// 预加载桥由 @quiteer/electron-preload 注入：window.$ipc 是通用 IPC
// （invoke / send / on / once / removeAllListeners）
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // @ts-expect-error 运行期由 preload 注入
  return window.$ipc.invoke(channel, ...args) as Promise<T>
}

function onEvent(cb: (ev: RunifyEvent) => void): () => void {
  const handler = (_e: unknown, ev: RunifyEvent) => cb(ev)
  // @ts-expect-error 运行期由 preload 注入
  window.$ipc.on(IPC.event, handler)
  return () => {
    // @ts-expect-error 运行期由 preload 注入
    window.$ipc.removeAllListeners(IPC.event)
  }
}

export const api = {
  getProjects: () => invoke<Project[]>(IPC.getProjects),
  getSettings: () => invoke<Settings>(IPC.getSettings),
  saveSettings: (s: Settings) => invoke<boolean>(IPC.saveSettings, s),
  getSystemTheme: () => invoke<SystemTheme>(IPC.getSystemTheme),
  setTheme: (mode: ThemeMode) => invoke<SystemTheme>(IPC.setTheme, mode),
  importProject: (path: string) => invoke<Project>(IPC.importProject, { path }),
  removeProject: (projectId: string) =>
    invoke<boolean>(IPC.removeProject, { projectId }),
  refreshProject: (projectId: string) =>
    invoke<Project | null>(IPC.refreshProject, { projectId }),
  updateProject: (projectId: string, patch: Partial<Project>) =>
    invoke<boolean>(IPC.updateProject, { projectId, patch }),
  run: (req: RunRequest) => invoke<RunInfo>(IPC.run, req),
  stop: (runId: string) => invoke<boolean>(IPC.stop, { runId }),
  openFolder: (path: string) => invoke<boolean>(IPC.openFolder, { path }),
  openTerminal: (path: string) => invoke<boolean>(IPC.openTerminal, { path }),
  openUrl: (url: string) => invoke<boolean>(IPC.openUrl, { url }),
  readEnv: (path: string) => invoke<Record<string, string>>(IPC.readEnv, { path }),
  exportLog: (runId: string) => invoke<string | null>(IPC.exportLog, { runId }),
  pickFolder: () => invoke<string | null>(IPC.pickFolder),
  getTasks: () => invoke<import('../shared/types').TaskPlan[]>(IPC.getTasks),
  saveTasks: (tasks: import('../shared/types').TaskPlan[]) =>
    invoke<boolean>(IPC.saveTasks, { tasks }),
  envDetect: () => invoke<import('../shared/types').EnvSnapshot>(IPC.envDetect),
  envRunCommand: (command: string) =>
    invoke<RunInfo>(IPC.envRunCommand, { command }),
  envNodeVersions: () =>
    invoke<import('../shared/types').NodeDistVersion[]>(IPC.envNodeVersions),
  envPmLatestVersion: (name: 'pnpm' | 'yarn' | 'bun') =>
    invoke<string | null>(IPC.envPmLatestVersion, { name }),
  onEvent,
}

export type { EnvVar, LogEntry }
