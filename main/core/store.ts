import type { Project, Settings, TaskPlan, WindowState } from '../../shared/types'
import { promises as fs, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'

const dataDir = app.getPath('userData')
const projectsFile = path.join(dataDir, 'runify-projects.json')
const settingsFile = path.join(dataDir, 'runify-settings.json')
const tasksFile = path.join(dataDir, 'runify-tasks.json')
const windowFile = path.join(dataDir, 'runify-window.json')

export const defaultSettings: Settings = {
  defaultShell: process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh',
  globalEnv: [],
  logLimit: 2000,
  theme: 'system',
}

export async function loadProjects(): Promise<Project[]> {
  try {
    return JSON.parse(await fs.readFile(projectsFile, 'utf-8')) as Project[]
  }
  catch {
    return []
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(projectsFile, JSON.stringify(projects, null, 2))
}

export async function loadSettings(): Promise<Settings> {
  try {
    const s = JSON.parse(await fs.readFile(settingsFile, 'utf-8')) as Partial<Settings>
    return { ...defaultSettings, ...s }
  }
  catch {
    return { ...defaultSettings }
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(settingsFile, JSON.stringify(s, null, 2))
}

export async function loadTasks(): Promise<TaskPlan[]> {
  try {
    return JSON.parse(await fs.readFile(tasksFile, 'utf-8')) as TaskPlan[]
  }
  catch {
    return []
  }
}

export async function saveTasks(tasks: TaskPlan[]): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2))
}

export const defaultWindowState: WindowState = {
  x: null,
  y: null,
  width: 1200,
  height: 800,
  maximized: false,
}

export async function loadWindowState(): Promise<WindowState> {
  try {
    const s = JSON.parse(await fs.readFile(windowFile, 'utf-8')) as Partial<WindowState>
    return { ...defaultWindowState, ...s }
  }
  catch {
    return { ...defaultWindowState }
  }
}

export async function saveWindowState(s: WindowState): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(windowFile, JSON.stringify(s, null, 2))
}

/** 退出时同步落盘（close 事件里异步写来不及） */
export function saveWindowStateSync(s: WindowState): void {
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(windowFile, JSON.stringify(s, null, 2))
  }
  catch {
    // 窗口状态写失败不影响退出
  }
}
