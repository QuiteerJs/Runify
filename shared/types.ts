// 主进程 / 渲染进程共享的类型与 IPC 通道常量（纯类型 + 常量，编译期擦除，无运行时副作用）

export type ProjectStatus = 'idle' | 'running' | 'stopped' | 'error'

export type ProjectType
  = | 'vite'
    | 'webpack'
    | 'turborepo'
    | 'monorepo'
    | 'vue'
    | 'react'
    | 'script'
    | 'unknown'

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm'

export interface PkgScript {
  name: string
  command: string
}

export interface ProjectPackage {
  /** 相对项目根目录的路径，作为唯一 id */
  id: string
  name: string
  relativePath: string
  absolutePath: string
  scripts: PkgScript[]
  type: ProjectType[]
  /** package.json 元信息（best-effort，导入/刷新时采集） */
  version?: string
  author?: string
  description?: string
  /** 运行时依赖（仅 package.json 的 dependencies 字段），key 为包名、value 为版本 */
  dependencies?: Record<string, string>
  /** 开发依赖（devDependencies），key 为包名、value 为版本 */
  devDependencies?: Record<string, string>
  /** peer / 可选依赖（peerDependencies + optionalDependencies），单独展示，不计入运行时依赖 */
  peerDependencies?: Record<string, string>
}

export interface EnvVar {
  key: string
  value: string
  enabled: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  importTime: number
  type: ProjectType[]
  isMonorepo: boolean
  scripts: PkgScript[]
  packages: ProjectPackage[]
  /** 用户为该工程配置的环境变量 */
  env: EnvVar[]
  /** 该工程指定的 shell（空字符串表示使用全局默认 shell） */
  shell: string
  /** 检测到的包管理器（由 lock 文件推断，可为空） */
  pm?: PackageManager
  /** 当前 git 分支（导入/刷新时探测，可为空） */
  branch?: string
  /** 用户备注（卡片上展示，可为空） */
  note?: string
  /** 根 package.json 运行时依赖（仅 dependencies 字段） */
  dependencies?: Record<string, string>
  /** 根 package.json 开发依赖（devDependencies） */
  devDependencies?: Record<string, string>
  /** 根 package.json 的 peer / 可选依赖（peerDependencies + optionalDependencies） */
  peerDependencies?: Record<string, string>
}

/** 主题档位：light / dark 为手动锁定，system 跟随操作系统 */
export type ThemeMode = 'light' | 'dark' | 'system'

export interface Settings {
  /** 默认 shell 可执行文件路径，例如 /bin/zsh */
  defaultShell: string
  /** 全局环境变量，作用于所有工程的运行 */
  globalEnv: EnvVar[]
  /** 日志滑动窗口上限（行数） */
  logLimit: number
  theme: ThemeMode
}

/** 系统外观快照：渲染层据此初始化「跟随系统」档位 */
export interface SystemTheme {
  /** 当前实际是否深色（Electron 已按 themeSource 解析过） */
  dark: boolean
  /** Electron 当前的 themeSource，即渲染层应当显示的用户档位 */
  themeSource: ThemeMode
}

/** 任务编排中的单个步骤 */
export interface TaskStep {
  id: string
  /** 目标工程 */
  projectId: string
  /** 子包 id；null 表示根 package.json */
  packageId: string | null
  /** 脚本名 */
  script: string
  /** 执行模式：串行（等上一步完成再跑）/ 并行（与上一步同时跑） */
  mode: 'serial' | 'parallel'
}

/** 一个任务编排方案 */
export interface TaskPlan {
  id: string
  name: string
  steps: TaskStep[]
}

/** 主窗口的位置 / 尺寸记忆；x、y 为 null 表示尚未记录过位置 */
export interface WindowState {
  x: number | null
  y: number | null
  width: number
  height: number
  maximized: boolean
}

export interface LogEntry {
  ts: number
  stream: 'stdout' | 'stderr'
  text: string
}

export interface RunInfo {
  runId: string
  projectId: string
  /** null 表示运行根 package.json 的脚本；否则为某个子包的 id */
  packageId: string | null
  script: string
  status: ProjectStatus
  startedAt: number
  endedAt: number | null
  port: number | null
  exitCode: number | null
  exitSignal: string | null
  /** 本次运行实际使用的 node 版本（运行时探测，例如 "v20.11.0"），失败则为空 */
  nodeVersion: string | null
  /** 内存中的滑动窗口日志（受 logLimit 约束） */
  logs: LogEntry[]
}

/** 主进程 → 渲染进程推送的事件 */
export type RunifyEvent
  = | { kind: 'log', runId: string, stream: 'stdout' | 'stderr', text: string, ts: number }
    | { kind: 'status', runId: string, status: ProjectStatus, port: number | null }
    | { kind: 'exit', runId: string, code: number | null, signal: string | null, endedAt: number }
    | { kind: 'theme-changed', dark: boolean, themeSource: ThemeMode }

/** 运行请求：由渲染端组装好最终 env / shell 后下发 */
export interface RunRequest {
  projectId: string
  packageId: string | null
  script: string
  /** 已解析的具体 shell 路径 */
  shell: string
  /** 已合并过滤后的运行时环境变量 */
  env: EnvVar[]
  /** 追加到脚本命令后的额外参数串（例如 -- --host 0.0.0.0） */
  params: string
}

export const IPC = {
  getProjects: 'runify:getProjects',
  getSettings: 'runify:getSettings',
  saveSettings: 'runify:saveSettings',
  getSystemTheme: 'runify:getSystemTheme',
  /** 只切换主题档位：主进程设置 nativeTheme.themeSource 后回传解析结果 */
  setTheme: 'runify:setTheme',
  importProject: 'runify:importProject',
  removeProject: 'runify:removeProject',
  refreshProject: 'runify:refreshProject',
  updateProject: 'runify:updateProject',
  run: 'runify:run',
  stop: 'runify:stop',
  openFolder: 'runify:openFolder',
  openTerminal: 'runify:openTerminal',
  openUrl: 'runify:openUrl',
  readEnv: 'runify:readEnv',
  exportLog: 'runify:exportLog',
  pickFolder: 'runify:pickFolder',
  getTasks: 'runify:getTasks',
  saveTasks: 'runify:saveTasks',
  /** 环境管理：探测本机 Node 版本管理工具与运行时 */
  envDetect: 'runify:envDetect',
  /** 环境管理：执行与环境相关的独立命令（安装工具/切版本等），日志走事件流 */
  envRunCommand: 'runify:envRunCommand',
  /** 环境管理：官方源可安装的 Node 版本列表（nodejs.org dist index，主进程缓存 1 小时） */
  envNodeVersions: 'runify:envNodeVersions',
  /** 环境管理：包管理器（pnpm/yarn/bun）在 npm dist-tag latest 上的最新版（主进程缓存 10 分钟） */
  envPmLatestVersion: 'runify:envPmLatestVersion',
  /** 主进程推送事件的通道 */
  event: 'runify:event',
} as const

/** 本机已装的 Node 生态运行时（node 本体及各包管理器） */
export interface EnvRuntime {
  key: 'node' | 'npm' | 'pnpm' | 'yarn' | 'bun' | 'corepack'
  /** 版本号（如 v20.11.0），未安装为 null */
  version: string | null
  /** 可执行文件路径，未找到为 null */
  path: string | null
}

export type EnvManagerId = 'vitep' | 'nvm' | 'fnm' | 'volta' | 'n' | 'mise' | 'asdf'

/** 官方源（nodejs.org dist index）提供的一条 Node 版本信息 */
export interface NodeDistVersion {
  /** 版本号（不含 v 前缀），如 20.11.0 */
  version: string
  /** LTS 标记：非 LTS 为 false，LTS 为代号（如 "iron"） */
  lts: string | false
}

/** 本机 Node 版本管理工具的探测结果（best-effort） */
export interface EnvManager {
  id: EnvManagerId
  name: string
  installed: boolean
  /** 工具自身版本，未安装 / 探测失败为 null */
  version: string | null
  /** 可执行文件 / 安装脚本路径 */
  path: string | null
  /** 该工具下已安装的 node 版本列表 */
  nodeVersions: string[]
  /** 当前默认 / 激活的 node 版本 */
  defaultVersion: string | null
}

export interface EnvSnapshot {
  /** 探测使用的登录 shell */
  shell: string
  platform: string
  runtimes: EnvRuntime[]
  managers: EnvManager[]
}
